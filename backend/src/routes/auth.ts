import { Router, Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { generateOtp, hashOtp, verifyOtpHash } from "../utils/crypto.js";
import { signToken } from "../utils/jwt.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { normalizePhoneNumber, isValidPhoneNumber, maskPhoneNumber } from "../utils/phone.js";
import { sendOtpSms, isSmsConfigured } from "../services/smsService.js";

export const authRouter = Router();

// Input Validation Schemas
const requestOtpSchema = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
  target: z.string().optional(),
});

const verifyOtpSchema = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
  target: z.string().optional(),
  otp: z.string().min(6, "OTP must be 6 digits").max(6, "OTP must be 6 digits"),
});

/**
 * Standardize and validate phone/email input target
 */
function normalizeTarget(body: { phone?: string; email?: string; target?: string }): {
  target: string;
  targetType: "PHONE" | "EMAIL";
  isValid: boolean;
} {
  const raw = (body.target || body.phone || body.email || "").trim();
  if (!raw) {
    return { target: "", targetType: "PHONE", isValid: false };
  }

  if (raw.includes("@")) {
    const email = raw.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return {
      target: email,
      targetType: "EMAIL",
      isValid: emailRegex.test(email),
    };
  }

  const normalizedPhone = normalizePhoneNumber(raw);
  const isValid = isValidPhoneNumber(normalizedPhone);

  return {
    target: normalizedPhone,
    targetType: "PHONE",
    isValid,
  };
}

/**
 * POST /api/v1/auth/request-otp
 *
 * Requests a secure 6-digit OTP delivered via SMS (or email).
 * Rate limited to 1 request per 60 seconds and 5 requests per hour.
 */
authRouter.post("/request-otp", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const parseResult = requestOtpSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "Invalid target phone number or email address format",
      });
      return;
    }

    const { target, targetType, isValid } = normalizeTarget(req.body);

    if (!target || !isValid) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message:
          targetType === "PHONE"
            ? "Please enter a valid mobile number (e.g. 9876543210 or +919876543210)"
            : "Please enter a valid email address",
      });
      return;
    }

    // 1. Hourly Abuse Prevention: Max 5 requests per hour per target
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const hourlyChallengeCount = await prisma.otpChallenge.count({
      where: {
        target,
        createdAt: { gte: oneHourAgo },
      },
    });

    if (hourlyChallengeCount >= 5) {
      res.status(429).json({
        success: false,
        error: "Too Many Requests",
        message: "Too many OTP requests for this number. Please wait an hour before requesting again.",
      });
      return;
    }

    // 2. Resend Cooldown: Enforce 60-second delay between requests
    const sixtySecondsAgo = new Date(Date.now() - 60 * 1000);
    const recentChallenge = await prisma.otpChallenge.findFirst({
      where: {
        target,
        createdAt: { gte: sixtySecondsAgo },
      },
    });

    if (recentChallenge) {
      const elapsedSeconds = Math.floor((Date.now() - recentChallenge.createdAt.getTime()) / 1000);
      const remainingCooldown = Math.max(1, 60 - elapsedSeconds);
      res.status(429).json({
        success: false,
        error: "Too Many Requests",
        message: `Please wait ${remainingCooldown} seconds before requesting a new OTP.`,
        retryAfter: remainingCooldown,
      });
      return;
    }

    // 3. Invalidate previous unused challenges for this target
    await prisma.otpChallenge.updateMany({
      where: { target, isUsed: false },
      data: { isUsed: true },
    });

    // 4. Generate fresh 6-digit OTP & store cryptographic hash
    const otpCode = generateOtp();
    const otpHash = hashOtp(otpCode);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiration

    await prisma.otpChallenge.create({
      data: {
        target,
        targetType,
        otpHash,
        expiresAt,
        attempts: 0,
        isUsed: false,
      },
    });

    // 5. Send OTP via SMS Provider
    if (targetType === "PHONE") {
      try {
        await sendOtpSms(target, otpCode);
      } catch (smsErr: any) {
        console.error(`[Auth] SMS delivery failed for ${maskPhoneNumber(target)}:`, smsErr.message);
        res.status(502).json({
          success: false,
          error: "Bad Gateway",
          message: smsErr.message || "Failed to deliver SMS. Please check your phone number and try again.",
        });
        return;
      }
    }

    const masked = maskPhoneNumber(target);
    console.log(`[Auth] OTP issued and dispatched for ${masked} (valid for 5 mins)`);

    const responsePayload: Record<string, any> = {
      success: true,
      message: `OTP sent successfully to ${masked}`,
      target,
      targetType,
      expiresInSeconds: 300,
    };

    // Dev/Test helper: Expose devOtp ONLY if explicitly enabled, in non-production, and real SMS provider is not active
    const isDevExposed =
      process.env.NODE_ENV !== "production" &&
      process.env.DEV_EXPOSE_OTP === "true" &&
      !isSmsConfigured();

    if (isDevExposed) {
      responsePayload.devOtp = otpCode;
    }

    res.status(200).json(responsePayload);
  } catch (error) {
    console.error("Error in /request-otp:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: "Failed to process OTP request",
    });
  }
});

/**
 * POST /api/v1/auth/verify-otp
 *
 * Verifies submitted OTP against stored hash.
 * Single use, max 5 attempts, expires in 5 minutes.
 * On success: Authenticates existing user or initializes a new onboarding account, then issues JWT.
 */
authRouter.post("/verify-otp", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const parseResult = verifyOtpSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "Invalid OTP format or missing target",
      });
      return;
    }

    const { target, targetType, isValid } = normalizeTarget(req.body);
    const submittedOtp = req.body.otp.trim();

    if (!target || !isValid) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "Valid target phone number or email is required",
      });
      return;
    }

    // Find the latest active, unused challenge for this target
    const challenge = await prisma.otpChallenge.findFirst({
      where: { target, isUsed: false },
      orderBy: { createdAt: "desc" },
    });

    if (!challenge) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "No active OTP request found. Please request a new OTP code.",
      });
      return;
    }

    // Check expiration (5 minutes)
    if (new Date() > challenge.expiresAt) {
      await prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { isUsed: true },
      });
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "OTP code has expired. Please request a new code.",
      });
      return;
    }

    // Check attempt limit (max 5)
    if (challenge.attempts >= 5) {
      await prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { isUsed: true },
      });
      res.status(429).json({
        success: false,
        error: "Too Many Requests",
        message: "Too many failed attempts. This OTP is now invalidated. Please request a new one.",
      });
      return;
    }

    // Increment attempt count
    const updatedAttempts = challenge.attempts + 1;
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: updatedAttempts },
    });

    // Secure constant-time hash comparison
    const isValidOtp = verifyOtpHash(submittedOtp, challenge.otpHash);
    if (!isValidOtp) {
      const remainingAttempts = Math.max(0, 5 - updatedAttempts);
      if (remainingAttempts === 0) {
        await prisma.otpChallenge.update({
          where: { id: challenge.id },
          data: { isUsed: true },
        });
      }
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: `Invalid OTP code. ${remainingAttempts} attempt(s) remaining.`,
        remainingAttempts,
      });
      return;
    }

    // Invalidate OTP immediately upon successful verification (single-use)
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { isUsed: true },
    });

    // Find existing User
    let user = await prisma.user.findFirst({
      where: targetType === "PHONE" ? { phone: target } : { email: target },
    });

    if (!user) {
      // Create new User for new phone number with onboarding incomplete
      user = await prisma.user.create({
        data: {
          phone: targetType === "PHONE" ? target : null,
          email: targetType === "EMAIL" ? target : null,
          isPhoneVerified: targetType === "PHONE",
          isEmailVerified: targetType === "EMAIL",
          isOnboardingCompleted: false,
          activeMode: "JOINEE",
          homeCity: "Bengaluru",
        },
      });
      console.log(`[Auth] New user registered for ${maskPhoneNumber(target)} (ID: ${user.id})`);
    } else {
      // Mark phone/email verified on existing user without overwriting profile details
      user = await prisma.user.update({
        where: { id: user.id },
        data:
          targetType === "PHONE"
            ? { isPhoneVerified: true }
            : { isEmailVerified: true },
      });
      console.log(`[Auth] Existing user authenticated for ${maskPhoneNumber(target)} (ID: ${user.id}, Name: ${user.name || "N/A"})`);
    }

    // Issue JWT Token
    const token = signToken({
      userId: user.id,
      phone: user.phone,
      email: user.email,
    });

    res.status(200).json({
      success: true,
      message: "Authentication successful",
      token,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        isPhoneVerified: user.isPhoneVerified,
        isEmailVerified: user.isEmailVerified,
        isOnboardingCompleted: user.isOnboardingCompleted,
        activeMode: user.activeMode,
        name: user.name || "",
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        homeCity: user.homeCity,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error in /verify-otp:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: "Failed to verify OTP",
    });
  }
});

/**
 * GET /api/v1/auth/me
 * Retrieves current authenticated user session
 */
authRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    res.status(200).json({
      success: true,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        isPhoneVerified: user.isPhoneVerified,
        isEmailVerified: user.isEmailVerified,
        isOnboardingCompleted: user.isOnboardingCompleted,
        activeMode: user.activeMode,
        name: user.name || "",
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        homeCity: user.homeCity,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error in /me:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: "Failed to retrieve current user profile",
    });
  }
});

/**
 * POST /api/v1/auth/logout
 */
authRouter.post("/logout", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});
