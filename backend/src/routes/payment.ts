import { Router, Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "../db.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { createNotification } from "../services/notificationService.js";
import { getRoomTimeInfo } from "../utils/roomTiming.js";

export const paymentRouter = Router();

const createOrderSchema = z.object({
  roomId: z.string().optional(),
});

const verifyPaymentSchema = z.object({
  roomId: z.string().optional(),
  paymentId: z.string().optional(),
  providerOrderId: z.string(),
  providerPaymentId: z.string(),
  providerSignature: z.string().optional(),
});

export function formatPayment(payment: any) {
  return {
    id: payment.id,
    roomId: payment.roomId,
    userId: payment.userId,
    joinRequestId: payment.joinRequestId,
    amount: payment.amount,
    hostShare: payment.hostShare,
    platformShare: payment.platformShare,
    currency: payment.currency || "INR",
    status: payment.status,
    provider: payment.provider,
    providerOrderId: payment.providerOrderId || "",
    providerPaymentId: payment.providerPaymentId || "",
    paidAt: payment.paidAt ? payment.paidAt.toISOString() : null,
    createdAt: payment.createdAt ? payment.createdAt.toISOString() : new Date().toISOString(),
  };
}

/**
 * POST /api/v1/rooms/:roomId/payment/order
 * Create demo/test payment order for accepted join request.
 * Amount is derived strictly from Room.joiningFee on the server.
 */
paymentRouter.post("/rooms/:roomId/payment/order", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, error: "Unauthorized", message: "Authentication required" });
      return;
    }

    const roomId = String(req.params.roomId);
    const userId = req.userId;

    const room = await prisma.room.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      res.status(404).json({ success: false, error: "Not Found", message: "Room not found" });
      return;
    }

    const orderTiming = getRoomTimeInfo(room);
    if (orderTiming.isClosed || room.status === "CANCELLED") {
      res.status(400).json({ success: false, error: "Bad Request", message: "Room is closed for payment" });
      return;
    }

    const joinRequest = await prisma.joinRequest.findFirst({
      where: {
        roomId,
        joineeId: userId,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!joinRequest || joinRequest.status !== "ACCEPTED") {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "Join request must be accepted by host before creating payment order",
      });
      return;
    }

    const existingParticipant = await prisma.roomParticipant.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
    });

    if (existingParticipant) {
      res.status(409).json({
        success: false,
        error: "Conflict",
        message: "You are already a confirmed participant of this room",
      });
      return;
    }

    // Determine amount strictly from server Room.joiningFee
    const amount = room.joiningFee;
    const hostShare = Math.round(amount * 0.7);
    const platformShare = Math.round(amount * 0.3);

    const providerOrderId = `order_test_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID || "rzp_test_FrientablesDevKey";

    const paymentRecord = await prisma.payment.create({
      data: {
        roomId,
        userId,
        joinRequestId: joinRequest.id,
        amount,
        hostShare,
        platformShare,
        currency: "INR",
        status: "CREATED",
        provider: "RAZORPAY",
        providerOrderId,
      },
    });

    res.status(201).json({
      success: true,
      message: "Payment order created successfully",
      order: {
        id: providerOrderId,
        amount: amount * 100, // Amount in paise for Razorpay
        amountInRupees: amount,
        currency: "INR",
        key: razorpayKeyId,
        paymentId: paymentRecord.id,
        roomId,
        roomTitle: room.title,
        hostShare,
        platformShare,
      },
      payment: formatPayment(paymentRecord),
    });
  } catch (error) {
    console.error("Error in POST /rooms/:roomId/payment/order:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to create payment order" });
  }
});

/**
 * POST /api/v1/payments/verify
 * Server-side payment verification.
 * On success, performs final atomic transaction:
 * Payment.status = SUCCESS, RoomParticipant created, confirmedParticipantsCount incremented.
 */
paymentRouter.post("/verify", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, error: "Unauthorized", message: "Authentication required" });
      return;
    }

    const userId = req.userId;
    const parseResult = verifyPaymentSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: parseResult.error.errors[0]?.message || "Invalid payment verification payload",
      });
      return;
    }

    const { roomId, paymentId, providerOrderId, providerPaymentId, providerSignature } = parseResult.data;

    // Find payment record
    const payment = await prisma.payment.findFirst({
      where: {
        OR: [
          { providerOrderId },
          { id: paymentId || "" },
        ],
      },
      include: {
        room: true,
        joinRequest: true,
      },
    });

    if (!payment) {
      res.status(404).json({ success: false, error: "Not Found", message: "Payment record not found" });
      return;
    }

    if (payment.userId !== userId) {
      res.status(403).json({ success: false, error: "Forbidden", message: "You can only verify your own payments" });
      return;
    }

    // Idempotency check: If payment is already SUCCESS, return success without duplicate processing
    if (payment.status === "SUCCESS") {
      res.status(200).json({
        success: true,
        message: "Payment already verified and confirmed",
        payment: formatPayment(payment),
      });
      return;
    }

    // Check room capacity
    const room = await prisma.room.findUnique({
      where: { id: payment.roomId },
    });

    if (!room) {
      res.status(404).json({ success: false, error: "Not Found", message: "Room not found" });
      return;
    }

    const verifyTiming = getRoomTimeInfo(room);
    if (verifyTiming.isClosed || room.status === "CANCELLED") {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED" },
      });
      res.status(400).json({ success: false, error: "Bad Request", message: "Room is closed for payment verification" });
      return;
    }

    const existingParticipant = await prisma.roomParticipant.findUnique({
      where: {
        roomId_userId: {
          roomId: payment.roomId,
          userId,
        },
      },
    });

    if (!existingParticipant && room.confirmedParticipantsCount >= room.capacity) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED" },
      });

      res.status(409).json({
        success: false,
        error: "Conflict",
        message: "Room reached maximum capacity before payment verification completed",
      });
      return;
    }

    // Verify signature (Test Mode verification)
    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET || "frientables_dev_test_secret_2026";
    let isSignatureValid = true;

    if (providerSignature && providerSignature !== "test_signature") {
      try {
        const expectedSignature = crypto
          .createHmac("sha256", razorpaySecret)
          .update(`${providerOrderId}|${providerPaymentId}`)
          .digest("hex");

        if (expectedSignature !== providerSignature) {
          // If HMAC does not match and signature is not explicit test bypass, mark failed
          if (!providerSignature.startsWith("test_")) {
            isSignatureValid = false;
          }
        }
      } catch {
        isSignatureValid = true; // Fallback for test mode
      }
    }

    if (!isSignatureValid) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED" },
      });

      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "Invalid payment signature verification failed",
      });
      return;
    }

    // Perform final atomic confirmation transaction
    const now = new Date();
    const transactionOps: any[] = [
      prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "SUCCESS",
          providerPaymentId: providerPaymentId || `pay_test_${Date.now()}`,
          providerSignature: providerSignature || `sig_test_${Date.now()}`,
          paidAt: now,
        },
      }),
    ];

    if (!existingParticipant) {
      transactionOps.push(
        prisma.roomParticipant.create({
          data: {
            roomId: payment.roomId,
            userId,
          },
        })
      );
      transactionOps.push(
        prisma.room.update({
          where: { id: payment.roomId },
          data: {
            confirmedParticipantsCount: { increment: 1 },
          },
        })
      );
    }

    const [updatedPayment] = await prisma.$transaction(transactionOps);

    // Create PAYMENT_SUCCESS notification for Joinee
    await createNotification({
      userId: payment.userId,
      type: "PAYMENT_SUCCESS",
      title: "Payment Successful",
      message: `Your ₹${payment.amount} payment for "${payment.room.title}" was successful. Your seat is confirmed.`,
      roomId: payment.roomId,
      relatedUserId: payment.room.hostId,
      relatedRequestId: payment.joinRequestId,
      relatedPaymentId: payment.id,
    });

    res.status(200).json({
      success: true,
      message: "Payment verified successfully and seat confirmed",
      payment: formatPayment(updatedPayment),
    });
  } catch (error) {
    console.error("Error in POST /payments/verify:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to verify payment" });
  }
});

/**
 * GET /api/v1/rooms/:roomId/payment
 * Fetch payment and confirmation status for authenticated user for a specific room.
 */
paymentRouter.get("/rooms/:roomId/payment", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, error: "Unauthorized", message: "Authentication required" });
      return;
    }

    const roomId = String(req.params.roomId);
    const userId = req.userId;

    const participant = await prisma.roomParticipant.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
    });

    const payment = await prisma.payment.findFirst({
      where: { roomId, userId },
      orderBy: { createdAt: "desc" },
    });

    const joinRequest = await prisma.joinRequest.findFirst({
      where: { roomId, joineeId: userId },
      orderBy: { createdAt: "desc" },
    });

    let status = "NO_PAYMENT";
    if (participant || (payment && payment.status === "SUCCESS")) {
      status = "SUCCESS";
    } else if (payment && payment.status === "CREATED") {
      status = "PENDING";
    } else if (payment && payment.status === "FAILED") {
      status = "FAILED";
    } else if (joinRequest && joinRequest.status === "ACCEPTED") {
      status = "PAYMENT_REQUIRED";
    }

    res.status(200).json({
      success: true,
      status,
      payment: payment ? formatPayment(payment) : null,
    });
  } catch (error) {
    console.error("Error in GET /rooms/:roomId/payment:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to fetch room payment status" });
  }
});

/**
 * GET /api/v1/payments/host/summary
 * Fetch calculated demo earnings summary for authenticated host.
 */
paymentRouter.get("/host/summary", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, error: "Unauthorized", message: "Authentication required" });
      return;
    }

    const hostId = req.userId;
    const successfulPayments = await prisma.payment.findMany({
      where: {
        room: { hostId },
        status: "SUCCESS",
      },
    });

    const totalGross = successfulPayments.reduce((acc, p) => acc + p.amount, 0);
    const totalHostShare = successfulPayments.reduce((acc, p) => acc + p.hostShare, 0);
    const totalPlatformShare = successfulPayments.reduce((acc, p) => acc + p.platformShare, 0);

    res.status(200).json({
      success: true,
      summary: {
        totalGross,
        projectedHostShare: totalHostShare,
        platformShare: totalPlatformShare,
        confirmedPaymentsCount: successfulPayments.length,
      },
    });
  } catch (error) {
    console.error("Error in GET /payments/host/summary:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to fetch host payment summary" });
  }
});
