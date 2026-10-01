import { Router, Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { formatUserProfile } from "./user.js";
import { getMaximumJoiningFee } from "../utils/feeLimit.js";
import { getRoomTimeInfo, autoCloseExpiredRooms, parseTimeToMinutes } from "../utils/roomTiming.js";
import jwt from "jsonwebtoken";
import { createNotification } from "../services/notificationService.js";
import { checkUserRoomConflict } from "../services/roomConflictService.js";
import { normalizeCityName, getCityMatchCandidates } from "../utils/city.js";

export const roomRouter = Router();

export function computeRoomDateTime(
  dateStr?: string | null,
  timeStr?: string | null,
  explicitDateTime?: string | Date | null,
  fallbackDateTime?: Date | null
): Date {
  if (explicitDateTime) {
    const d = new Date(explicitDateTime);
    if (!isNaN(d.getTime())) return d;
  }
  let base = dateStr ? new Date(dateStr) : (fallbackDateTime ? new Date(fallbackDateTime) : new Date());
  if (isNaN(base.getTime())) base = new Date();
  if (base.getFullYear() < new Date().getFullYear()) {
    base.setFullYear(new Date().getFullYear());
  }

  if (timeStr) {
    const matched = timeStr.match(/(\d+):?(\d+)?\s*(AM|PM)?/i);
    if (matched) {
      let hours = parseInt(matched[1], 10);
      const minutes = matched[2] ? parseInt(matched[2], 10) : 0;
      const ampm = matched[3] ? matched[3].toUpperCase() : null;

      if (ampm === "PM" && hours < 12) hours += 12;
      if (ampm === "AM" && hours === 12) hours = 0;

      base.setHours(hours, minutes, 0, 0);
    }
  }

  return base;
}

export function validateStartAndEndTimeString(timeStr?: string | null): { isValid: boolean; message?: string } {
  if (!timeStr || typeof timeStr !== "string") {
    return { isValid: false, message: "Start time and End time are required." };
  }

  const parts = timeStr.split(/–|-/);
  if (parts.length < 2) {
    return { isValid: false, message: "End time is required. Please specify both Start Time and End Time (e.g. 7:30 PM - 9:00 PM)." };
  }

  const startMins = parseTimeToMinutes(parts[0].trim());
  const endMins = parseTimeToMinutes(parts[1].trim());

  if (startMins === null) {
    return { isValid: false, message: "Valid start time is required (e.g. 7:30 PM)." };
  }

  if (endMins === null) {
    return { isValid: false, message: "End time is required (e.g. 9:00 PM)." };
  }

  if (endMins <= startMins) {
    return { isValid: false, message: "End time must be later than start time." };
  }

  return { isValid: true };
}

const createRoomSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters").max(100),
  description: z.string().max(1000, "Description max length is 1000 characters"),
  interests: z.array(z.string()).default([]),
  venueName: z.string().min(1, "Venue name is required"),
  venueAddress: z.string().min(1, "Venue address is required"),
  city: z
    .string()
    .trim()
    .min(1, "Dining city is required. Please select a city before creating a room.")
    .refine((val) => val.toLowerCase() !== "current location", {
      message: "Please select a specific city for your dinner instead of generic 'Current Location'.",
    }),
  area: z.string().optional(),
  googleMapsUrl: z.string().optional(),
  imageUrl: z.string().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  dateTime: z.string().optional(),
  capacity: z.number().int().min(1, "Capacity must be at least 1"),
  joiningFee: z.number().int().min(0, "Joining fee must be a non-negative integer"),
  reservationStatus: z.string().optional(),
});

const editRoomSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters").max(100).optional(),
  description: z.string().max(1000, "Description max length is 1000 characters").optional(),
  interests: z.array(z.string()).optional(),
  venueName: z.string().min(1, "Venue name is required").optional(),
  venueAddress: z.string().min(1, "Venue address is required").optional(),
  city: z.string().trim().min(1, "City cannot be empty").optional(),
  area: z.string().optional(),
  googleMapsUrl: z.string().optional(),
  imageUrl: z.string().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  dateTime: z.string().optional(),
  capacity: z.number().int().min(1, "Capacity must be at least 1").optional(),
  joiningFee: z.number().int().min(0, "Joining fee must be a non-negative integer").optional(),
  reservationStatus: z.string().optional(),
});

export function formatRoom(room: any) {
  let parsedInterests: string[] = [];
  try {
    if (room.interests) {
      parsedInterests = typeof room.interests === "string" ? JSON.parse(room.interests) : room.interests;
    }
  } catch {
    parsedInterests = [];
  }

  const hostProfile = room.host ? formatUserProfile(room.host) : null;
  const isCancelled = room.status === "CANCELLED";

  const hostParticipant = hostProfile ? [
    {
      user: hostProfile,
      joinedAt: room.createdAt ? new Date(room.createdAt).toISOString() : new Date().toISOString(),
      requestStatus: isCancelled ? "CANCELLED" : "CONFIRMED",
      paymentStatus: "CAPTURED",
      attendanceStatus: "PENDING",
    },
  ] : [];

  const joineeParticipants = (room.participants || []).map((p: any) => ({
    user: p.user ? formatUserProfile(p.user) : null,
    joinedAt: p.joinedAt ? new Date(p.joinedAt).toISOString() : new Date().toISOString(),
    requestStatus: isCancelled ? "CANCELLED" : "CONFIRMED",
    paymentStatus: isCancelled ? "REFUNDED" : "CAPTURED",
    attendanceStatus: "PENDING",
  })).filter((p: any) => p.user !== null);

  const allParticipants = [...hostParticipant, ...joineeParticipants];

  const timing = getRoomTimeInfo(room);
  const hasAttendance = isCancelled ? false : Boolean(room.attendances && room.attendances.length > 0);
  const isCompleted = !isCancelled && timing.isCompleted;

  return {
    id: room.id,
    hostId: room.hostId,
    title: room.title,
    description: room.description,
    imageUrl: room.imageUrl || "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=800",
    host: hostProfile,
    venueName: room.venueName,
    venueAddress: room.venueAddress,
    city: room.city,
    area: room.area || "",
    googleMapsUrl: room.googleMapsUrl || "",
    date: room.date || "",
    time: room.time || "",
    dateTime: room.dateTime ? room.dateTime.toISOString() : null,
    capacity: room.capacity,
    joiningFee: room.joiningFee,
    reservationStatus: room.reservationStatus || "CONFIRMED",
    interests: parsedInterests,
    status: isCancelled ? "CANCELLED" : (isCompleted ? "COMPLETED" : room.status),
    hasAttendance,
    totalCheckedIn: isCancelled ? 0 : (room.attendances ? room.attendances.length : 0),
    confirmedParticipantsCount: room.confirmedParticipantsCount || 0,
    participants: allParticipants,
    publishedAt: room.publishedAt ? new Date(room.publishedAt).toISOString() : null,
    createdAt: room.createdAt ? new Date(room.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: room.updatedAt ? new Date(room.updatedAt).toISOString() : new Date().toISOString(),
    closingTime: timing.closingTime.toISOString(),
    isClosed: timing.isClosed,
    isWithin90Days: timing.isWithin90Days,
  };
}

export function formatJoinRequest(joinReq: any) {
  const applicant = joinReq.joinee ? formatUserProfile(joinReq.joinee) : null;
  const room = joinReq.room;

  const timing = room ? getRoomTimeInfo(room) : null;
  const userAttendance = room && room.attendances && Array.isArray(room.attendances)
    ? room.attendances.find((a: any) => a.userId === joinReq.joineeId)
    : null;
  const isRoomCancelled = room ? room.status === "CANCELLED" : false;
  const isReqCancelled = joinReq.status === "CANCELLED" || isRoomCancelled;
  const effectiveReqStatus = isReqCancelled ? "CANCELLED" : joinReq.status;
  const hasAttended = isReqCancelled ? false : Boolean(userAttendance);
  const roomCompleted = (!isRoomCancelled && timing) ? timing.isCompleted : false;
  const isCompleted = !isReqCancelled && !isRoomCancelled && joinReq.status === "CONFIRMED" && roomCompleted;

  return {
    id: joinReq.id,
    roomId: joinReq.roomId,
    roomTitle: room ? room.title : "",
    roomImageUrl: room ? (room.imageUrl || "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=800") : "",
    venueName: room ? room.venueName : "",
    city: room ? room.city : "",
    date: room ? (room.date || "") : "",
    time: room ? (room.time || "") : "",
    joiningFee: room ? room.joiningFee : 0,
    applicant,
    status: effectiveReqStatus,
    requestedAt: joinReq.createdAt ? new Date(joinReq.createdAt).toISOString() : new Date().toISOString(),
    hostResponseAt: joinReq.respondedAt ? new Date(joinReq.respondedAt).toISOString() : undefined,
    hasAttended,
    isCompleted,
    roomStatus: isRoomCancelled ? "CANCELLED" : (roomCompleted ? "COMPLETED" : (room ? room.status : undefined)),
    closingTime: timing ? timing.closingTime.toISOString() : undefined,
    isClosed: timing ? timing.isClosed : false,
    isWithin90Days: timing ? timing.isWithin90Days : true,
  };
}

/**
 * Helper to optionally extract userId from Bearer token
 */
function getOptionalUserId(req: any): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.split(" ")[1];
  try {
    const jwtSecret = process.env.JWT_SECRET || "frientables_dev_secret_key_change_in_prod";
    const decoded = jwt.verify(token, jwtSecret) as { userId: string };
    return decoded.userId;
  } catch {
    return null;
  }
}

/**
 * GET /api/v1/rooms
 * Return published rooms for discovery / feeds. Optional city, interest, search filters.
 */
roomRouter.get("/", async (req: any, res: Response): Promise<void> => {
  try {
    await autoCloseExpiredRooms();
    const { city, interest, search } = req.query;

    const whereClause: any = {
      status: "PUBLISHED",
    };

    if (city && typeof city === "string" && city !== "All" && city.trim().length > 0) {
      const candidates = getCityMatchCandidates(city);
      whereClause.city = { in: candidates };
    }

    let rooms = await prisma.room.findMany({
      where: whereClause,
      include: {
        host: true,
        participants: { include: { user: true } },
        attendances: true,
      },
      orderBy: { createdAt: "desc" },
    });

    if (city && typeof city === "string" && city !== "All" && city.trim().length > 0) {
      const targetNorm = normalizeCityName(city);
      rooms = rooms.filter((r) => normalizeCityName(r.city) === targetNorm);
    }

    if (interest && typeof interest === "string" && interest !== "All") {
      const qInterest = interest.toLowerCase();
      rooms = rooms.filter((r) => {
        try {
          const interestsArr: string[] = typeof r.interests === "string" ? JSON.parse(r.interests) : r.interests;
          return interestsArr.some((i) => i.toLowerCase() === qInterest);
        } catch {
          return false;
        }
      });
    }

    if (search && typeof search === "string" && search.trim().length > 0) {
      const q = search.toLowerCase();
      rooms = rooms.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.venueName.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q)
      );
    }

    res.status(200).json({
      success: true,
      rooms: rooms.map(formatRoom),
    });
  } catch (error) {
    console.error("Error in GET /rooms:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to fetch published rooms" });
  }
});

/**
 * GET /api/v1/rooms/my-rooms
 * Return rooms owned by authenticated user.
 */
roomRouter.get("/my-rooms", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await autoCloseExpiredRooms();
    const rooms = await prisma.room.findMany({
      where: { hostId: req.userId },
      include: {
        host: true,
        participants: { include: { user: true } },
        attendances: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      success: true,
      rooms: rooms.map(formatRoom),
    });
  } catch (error) {
    console.error("Error in GET /my-rooms:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to fetch host rooms" });
  }
});

/**
 * GET /api/v1/rooms/host/requests
 * Return join requests for rooms owned by authenticated host.
 */
roomRouter.get("/host/requests", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, error: "Unauthorized", message: "Authentication required" });
      return;
    }
    const hostId = req.userId;
    const { status } = req.query;

    const whereClause: any = {
      room: {
        hostId,
      },
    };

    if (status && typeof status === "string" && status !== "ALL") {
      whereClause.status = status;
    }

    const requests = await prisma.joinRequest.findMany({
      where: whereClause,
      include: {
        room: { include: { host: true, attendances: true } },
        joinee: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      success: true,
      requests: requests.map(formatJoinRequest),
    });
  } catch (error) {
    console.error("Error in GET /rooms/host/requests:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to fetch host requests" });
  }
});

/**
 * GET /api/v1/rooms/user/requests
 * Return join requests submitted by authenticated joinee.
 */
roomRouter.get("/user/requests", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, error: "Unauthorized", message: "Authentication required" });
      return;
    }
    const joineeId = req.userId;

    const requests = await prisma.joinRequest.findMany({
      where: { joineeId },
      include: {
        room: { include: { host: true, attendances: true } },
        joinee: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      success: true,
      requests: requests.map(formatJoinRequest),
    });
  } catch (error) {
    console.error("Error in GET /rooms/user/requests:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to fetch user requests" });
  }
});

/**
 * GET /api/v1/rooms/:id
 * Single room retrieval. Drafts are viewable ONLY by their Host.
 */
roomRouter.get("/:id", async (req: any, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const room = await prisma.room.findUnique({
      where: { id },
      include: {
        host: true,
        participants: { include: { user: true } },
        attendances: true,
      },
    });

    if (!room) {
      res.status(404).json({ success: false, error: "Not Found", message: "Room not found" });
      return;
    }

    if (room.status === "DRAFT") {
      const callerId = getOptionalUserId(req);
      if (!callerId || callerId !== room.hostId) {
        res.status(403).json({
          success: false,
          error: "Forbidden",
          message: "Draft rooms are only viewable by their host owner",
        });
        return;
      }
    }

    res.status(200).json({
      success: true,
      room: formatRoom(room),
    });
  } catch (error) {
    console.error("Error in GET /rooms/:id:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to fetch room" });
  }
});

/**
 * POST /api/v1/rooms
 * Create room (defaults to DRAFT state).
 * Must be in HOST mode. Enforces host-level max joining fee limit.
 */
roomRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
    });

    if (!user) {
      res.status(401).json({ success: false, error: "Unauthorized", message: "User not found" });
      return;
    }

    if (user.activeMode !== "HOST") {
      res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "Only users in HOST mode can create rooms",
      });
      return;
    }

    const parseResult = createRoomSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: parseResult.error.errors[0]?.message || "Invalid room payload",
      });
      return;
    }

    const data = parseResult.data;

    // Enforce host level joining fee limit
    const maxFee = getMaximumJoiningFee(user.hostLevel);
    if (data.joiningFee > maxFee) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: `As a ${user.hostLevel} Host, your maximum allowed joining fee is ₹${maxFee}.`,
      });
      return;
    }

    // Validate start and end time range (end > start)
    const effectiveTime = data.time || "7:30 PM - 9:00 PM";
    const timeVal = validateStartAndEndTimeString(effectiveTime);
    if (!timeVal.isValid) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: timeVal.message || "End time must be later than start time.",
      });
      return;
    }

    const computedDateTime = computeRoomDateTime(data.date, effectiveTime, data.dateTime);

    const candidateTiming = getRoomTimeInfo({
      date: data.date,
      time: effectiveTime,
      dateTime: computedDateTime,
    });

    const createResult = await prisma.$transaction(async (tx) => {
      const conflict = await checkUserRoomConflict(
        tx,
        user.id,
        candidateTiming.scheduledStartTime,
        candidateTiming.scheduledEndTime
      );

      if (conflict.hasConflict) {
        return {
          conflict: true,
          message: conflict.message || "You already have another dining experience scheduled during this time.",
        };
      }

      const newRoom = await tx.room.create({
        data: {
          hostId: user.id,
          title: data.title,
          description: data.description,
          interests: JSON.stringify(data.interests),
          venueName: data.venueName,
          venueAddress: data.venueAddress,
          city: normalizeCityName(data.city),
          area: data.area || null,
          googleMapsUrl: data.googleMapsUrl || null,
          imageUrl: data.imageUrl || "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=800",
          date: data.date || null,
          time: data.time || null,
          dateTime: computedDateTime,
          capacity: data.capacity,
          joiningFee: data.joiningFee,
          reservationStatus: data.reservationStatus || "CONFIRMED",
          status: "DRAFT",
          confirmedParticipantsCount: 0,
          publishedAt: null,
        },
        include: {
          host: true,
          participants: { include: { user: true } },
        },
      });

      return { conflict: false, room: newRoom };
    });

    if (createResult.conflict) {
      res.status(409).json({
        success: false,
        error: "Conflict",
        message: createResult.message,
      });
      return;
    }

    res.status(201).json({
      success: true,
      message: "Room draft created successfully",
      room: formatRoom(createResult.room),
    });
  } catch (error) {
    console.error("Error in POST /rooms:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to create room" });
  }
});

/**
 * PATCH /api/v1/rooms/:id
 * Edit room draft. Must be owner. Cannot change hostId, state, or confirmedParticipantsCount.
 */
roomRouter.patch("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);

    const existingRoom = await prisma.room.findUnique({
      where: { id },
      include: {
        attendances: true,
      },
    });

    if (!existingRoom) {
      res.status(404).json({ success: false, error: "Not Found", message: "Room not found" });
      return;
    }

    if (existingRoom.hostId !== req.userId) {
      res.status(403).json({ success: false, error: "Forbidden", message: "You can only edit your own rooms" });
      return;
    }

    if (existingRoom.status === "CANCELLED" || existingRoom.status === "COMPLETED") {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: `Cannot edit a ${existingRoom.status.toLowerCase()} room`,
      });
      return;
    }

    const parseResult = editRoomSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: parseResult.error.errors[0]?.message || "Invalid edit room payload",
      });
      return;
    }

    const data = parseResult.data;

    // Disallow editing schedule after attendance has already been recorded
    const isEditingSchedule = data.date !== undefined || data.time !== undefined || data.dateTime !== undefined;
    if (existingRoom.attendances && existingRoom.attendances.length > 0 && isEditingSchedule) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "Cannot edit room schedule after participants have already checked in.",
      });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } });

    if (data.joiningFee !== undefined) {
      const maxFee = getMaximumJoiningFee(user?.hostLevel);
      if (data.joiningFee > maxFee) {
        res.status(400).json({
          success: false,
          error: "Bad Request",
          message: `As a ${user?.hostLevel || "NEW"} Host, your maximum allowed joining fee is ₹${maxFee}.`,
        });
        return;
      }
    }

    const targetDate = data.date !== undefined ? data.date : existingRoom.date;
    const targetTime = (data.time !== undefined && data.time !== "") ? data.time : (existingRoom.time || "7:30 PM - 9:00 PM");

    // Validate start and end time range (end > start)
    const timeVal = validateStartAndEndTimeString(targetTime);
    if (!timeVal.isValid) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: timeVal.message || "End time must be later than start time.",
      });
      return;
    }
    const computedDateTime = computeRoomDateTime(
      targetDate,
      targetTime,
      data.dateTime !== undefined ? data.dateTime : null,
      existingRoom.dateTime
    );

    const candidateTiming = getRoomTimeInfo({
      date: targetDate,
      time: targetTime,
      dateTime: computedDateTime,
      publishedAt: existingRoom.publishedAt,
      createdAt: existingRoom.createdAt,
      status: existingRoom.status,
    });

    const updateData: Record<string, any> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.interests !== undefined) updateData.interests = JSON.stringify(data.interests);
    if (data.venueName !== undefined) updateData.venueName = data.venueName;
    if (data.venueAddress !== undefined) updateData.venueAddress = data.venueAddress;
    if (data.city !== undefined) updateData.city = normalizeCityName(data.city);
    if (data.area !== undefined) updateData.area = data.area;
    if (data.googleMapsUrl !== undefined) updateData.googleMapsUrl = data.googleMapsUrl;
    if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
    if (data.date !== undefined) updateData.date = data.date;
    if (data.time !== undefined) updateData.time = data.time;
    if (data.dateTime !== undefined || data.date !== undefined || data.time !== undefined) {
      updateData.dateTime = computedDateTime;
    }
    if (data.capacity !== undefined) updateData.capacity = data.capacity;
    if (data.joiningFee !== undefined) updateData.joiningFee = data.joiningFee;
    if (data.reservationStatus !== undefined) updateData.reservationStatus = data.reservationStatus;

    const patchResult = await prisma.$transaction(async (tx) => {
      const conflict = await checkUserRoomConflict(
        tx,
        req.userId!,
        candidateTiming.scheduledStartTime,
        candidateTiming.scheduledEndTime,
        id
      );

      if (conflict.hasConflict) {
        return {
          conflict: true,
          message: conflict.message || "You already have another dining experience scheduled during this time.",
        };
      }

      const updatedRoom = await tx.room.update({
        where: { id },
        data: updateData,
        include: {
          host: true,
          participants: { include: { user: true } },
        },
      });

      return { conflict: false, room: updatedRoom };
    });

    if (patchResult.conflict) {
      res.status(409).json({
        success: false,
        error: "Conflict",
        message: patchResult.message,
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Room updated successfully",
      room: formatRoom(patchResult.room),
    });
  } catch (error) {
    console.error("Error in PATCH /rooms/:id:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to edit room" });
  }
});

/**
 * POST /api/v1/rooms/:id/publish
 * Publish a draft room. Must be owner. Sets status = PUBLISHED and publishedAt = now.
 */
roomRouter.post("/:id/publish", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);

    const existingRoom = await prisma.room.findUnique({
      where: { id },
    });

    if (!existingRoom) {
      res.status(404).json({ success: false, error: "Not Found", message: "Room not found" });
      return;
    }

    if (existingRoom.hostId !== req.userId) {
      res.status(403).json({ success: false, error: "Forbidden", message: "You can only publish your own rooms" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    const maxFee = getMaximumJoiningFee(user?.hostLevel);

    if (existingRoom.joiningFee > maxFee) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: `As a ${user?.hostLevel || "NEW"} Host, your maximum allowed joining fee is ₹${maxFee}.`,
      });
      return;
    }

    const timing = getRoomTimeInfo(existingRoom);
    const publishResult = await prisma.$transaction(async (tx) => {
      const conflict = await checkUserRoomConflict(
        tx,
        req.userId!,
        timing.scheduledStartTime,
        timing.scheduledEndTime,
        id
      );

      if (conflict.hasConflict) {
        return {
          conflict: true,
          message: conflict.message || "You already have another dining experience scheduled during this time.",
        };
      }

      const publishedRoom = await tx.room.update({
        where: { id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
        include: {
          host: true,
          participants: { include: { user: true } },
        },
      });

      return { conflict: false, room: publishedRoom };
    });

    if (publishResult.conflict) {
      res.status(409).json({
        success: false,
        error: "Conflict",
        message: publishResult.message,
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Room published successfully",
      room: formatRoom(publishResult.room),
    });
  } catch (error) {
    console.error("Error in POST /rooms/:id/publish:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to publish room" });
  }
});

/**
 * POST /api/v1/rooms/:roomId/join-requests
 * Submit a join request for a published room.
 */
roomRouter.post("/:roomId/join-requests", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, error: "Unauthorized", message: "Authentication required" });
      return;
    }
    const roomId = String(req.params.roomId);
    const joineeId = req.userId;

    const room = await prisma.room.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      res.status(404).json({ success: false, error: "Not Found", message: "Room not found" });
      return;
    }

    const timing = getRoomTimeInfo(room);
    if (timing.isClosed || room.status === "CANCELLED") {
      res.status(400).json({ success: false, error: "Bad Request", message: "Room is closed for new join requests" });
      return;
    }

    if (room.status !== "PUBLISHED") {
      res.status(400).json({ success: false, error: "Bad Request", message: "Join requests can only be sent to published rooms" });
      return;
    }

    if (room.hostId === joineeId) {
      res.status(403).json({ success: false, error: "Forbidden", message: "Host cannot send a join request to their own room" });
      return;
    }

    const joinTxResult = await prisma.$transaction(async (tx) => {
      const conflict = await checkUserRoomConflict(
        tx,
        joineeId,
        timing.scheduledStartTime,
        timing.scheduledEndTime
      );

      if (conflict.hasConflict) {
        return {
          status: 409,
          error: "Conflict",
          message: conflict.message || "You already have another dining experience scheduled during this time.",
        };
      }

      const existingPending = await tx.joinRequest.findFirst({
        where: {
          roomId,
          joineeId,
          status: "PENDING",
        },
      });

      if (existingPending) {
        return { status: 409, error: "Conflict", message: "Request already sent" };
      }

      const existingParticipant = await tx.roomParticipant.findUnique({
        where: {
          roomId_userId: {
            roomId,
            userId: joineeId,
          },
        },
      });

      if (existingParticipant) {
        return { status: 409, error: "Conflict", message: "You are already a confirmed participant of this room" };
      }

      const newRequest = await tx.joinRequest.create({
        data: {
          roomId,
          joineeId,
          status: "PENDING",
        },
        include: {
          room: { include: { host: true } },
          joinee: true,
        },
      });

      return { status: 201, request: newRequest };
    });

    if (joinTxResult.error) {
      res.status(joinTxResult.status!).json({
        success: false,
        error: joinTxResult.error,
        message: joinTxResult.message,
      });
      return;
    }

    const newRequest = joinTxResult.request!;

    // Create notification for Host
    await createNotification({
      userId: room.hostId,
      type: "JOIN_REQUEST_RECEIVED",
      title: "New Join Request",
      message: `${newRequest.joinee?.name || "A user"} wants to join "${newRequest.room.title}".`,
      roomId: room.id,
      relatedUserId: joineeId,
      relatedRequestId: newRequest.id,
    });

    res.status(201).json({
      success: true,
      message: "Join request submitted successfully",
      request: formatJoinRequest(newRequest),
    });
  } catch (error) {
    console.error("Error in POST /rooms/:roomId/join-requests:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to create join request" });
  }
});

/**
 * POST /api/v1/rooms/:roomId/join-requests/:requestId/accept
 * Accept a pending join request. Host only.
 */
roomRouter.post("/:roomId/join-requests/:requestId/accept", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, error: "Unauthorized", message: "Authentication required" });
      return;
    }
    const roomId = String(req.params.roomId);
    const requestId = String(req.params.requestId);
    const hostId = req.userId;

    const joinRequest = await prisma.joinRequest.findUnique({
      where: { id: requestId },
      include: { room: true },
    });

    if (!joinRequest) {
      res.status(404).json({ success: false, error: "Not Found", message: "Join request not found" });
      return;
    }

    if (joinRequest.roomId !== roomId) {
      res.status(400).json({ success: false, error: "Bad Request", message: "Request does not belong to the specified room" });
      return;
    }

    if (joinRequest.room.hostId !== hostId) {
      res.status(403).json({ success: false, error: "Forbidden", message: "You can only manage requests for rooms you host" });
      return;
    }

    if (joinRequest.status !== "PENDING") {
      res.status(400).json({ success: false, error: "Bad Request", message: "Only PENDING requests can be accepted" });
      return;
    }

    const existingParticipant = await prisma.roomParticipant.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId: joinRequest.joineeId,
        },
      },
    });

    if (existingParticipant) {
      res.status(409).json({ success: false, error: "Conflict", message: "Joinee is already a confirmed participant" });
      return;
    }

    if (joinRequest.room.confirmedParticipantsCount >= joinRequest.room.capacity) {
      res.status(409).json({ success: false, error: "Conflict", message: "Room has reached maximum capacity" });
      return;
    }

    const updatedRequest = await prisma.joinRequest.update({
      where: { id: requestId },
      data: {
        status: "ACCEPTED",
        respondedAt: new Date(),
      },
      include: {
        room: { include: { host: true } },
        joinee: true,
      },
    });

    // Create notifications for Joinee: JOIN_REQUEST_ACCEPTED & PAYMENT_REQUIRED
    const hostUser = await prisma.user.findUnique({ where: { id: hostId } });
    await createNotification({
      userId: updatedRequest.joineeId,
      type: "JOIN_REQUEST_ACCEPTED",
      title: "Join Request Accepted 🎉",
      message: `${hostUser?.name || "The host"} accepted your request for "${updatedRequest.room.title}". Complete payment to confirm your seat.`,
      roomId,
      relatedUserId: hostId,
      relatedRequestId: requestId,
    });

    await createNotification({
      userId: updatedRequest.joineeId,
      type: "PAYMENT_REQUIRED",
      title: "Payment Required",
      message: `Complete your ₹${updatedRequest.room.joiningFee} payment for "${updatedRequest.room.title}" to confirm your seat.`,
      roomId,
      relatedUserId: hostId,
      relatedRequestId: requestId,
    });

    res.status(200).json({
      success: true,
      message: "Join request accepted successfully. Joinee must complete payment to confirm seat.",
      request: formatJoinRequest(updatedRequest),
    });
  } catch (error) {
    console.error("Error in POST /rooms/:roomId/join-requests/:requestId/accept:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to accept join request" });
  }
});

/**
 * POST /api/v1/rooms/:roomId/join-requests/:requestId/reject
 * Reject a pending join request. Host only.
 */
roomRouter.post("/:roomId/join-requests/:requestId/reject", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, error: "Unauthorized", message: "Authentication required" });
      return;
    }
    const roomId = String(req.params.roomId);
    const requestId = String(req.params.requestId);
    const hostId = req.userId;

    const joinRequest = await prisma.joinRequest.findUnique({
      where: { id: requestId },
      include: { room: true },
    });

    if (!joinRequest) {
      res.status(404).json({ success: false, error: "Not Found", message: "Join request not found" });
      return;
    }

    if (joinRequest.roomId !== roomId) {
      res.status(400).json({ success: false, error: "Bad Request", message: "Request does not belong to the specified room" });
      return;
    }

    if (joinRequest.room.hostId !== hostId) {
      res.status(403).json({ success: false, error: "Forbidden", message: "You can only manage requests for rooms you host" });
      return;
    }

    if (joinRequest.status !== "PENDING") {
      res.status(400).json({ success: false, error: "Bad Request", message: "Only PENDING requests can be rejected" });
      return;
    }

    const updatedRequest = await prisma.joinRequest.update({
      where: { id: requestId },
      data: {
        status: "REJECTED",
        respondedAt: new Date(),
      },
      include: {
        room: { include: { host: true } },
        joinee: true,
      },
    });

    // Create notification for Joinee: JOIN_REQUEST_REJECTED
    await createNotification({
      userId: updatedRequest.joineeId,
      type: "JOIN_REQUEST_REJECTED",
      title: "Join Request Declined",
      message: `Your request to join "${updatedRequest.room.title}" was declined by the Host.`,
      roomId,
      relatedUserId: hostId,
      relatedRequestId: requestId,
    });

    res.status(200).json({
      success: true,
      message: "Join request rejected successfully",
      request: formatJoinRequest(updatedRequest),
    });
  } catch (error) {
    console.error("Error in POST /rooms/:roomId/join-requests/:requestId/reject:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to reject join request" });
  }
});

/**
 * GET /api/v1/rooms/:roomId/join-request
 * Get request status for authenticated joinee for a specific room.
 */
roomRouter.get("/:roomId/join-request", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, error: "Unauthorized", message: "Authentication required" });
      return;
    }
    const roomId = String(req.params.roomId);
    const joineeId = req.userId;

    const participant = await prisma.roomParticipant.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId: joineeId,
        },
      },
    });

    const joinRequest = await prisma.joinRequest.findFirst({
      where: { roomId, joineeId },
      include: {
        room: { include: { host: true, attendances: true } },
        joinee: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const room = joinRequest?.room ?? await prisma.room.findUnique({ where: { id: roomId } });
    const isCancelled = room?.status === "CANCELLED" || joinRequest?.status === "CANCELLED";

    if (isCancelled) {
      res.status(200).json({
        success: true,
        status: "CANCELLED",
        request: joinRequest ? formatJoinRequest(joinRequest) : null,
      });
      return;
    }

    if (participant) {
      res.status(200).json({
        success: true,
        status: "CONFIRMED",
        request: joinRequest ? formatJoinRequest(joinRequest) : null,
      });
      return;
    }

    if (joinRequest) {
      res.status(200).json({
        success: true,
        status: joinRequest.status,
        request: formatJoinRequest(joinRequest),
      });
      return;
    }

    res.status(200).json({
      success: true,
      status: "NONE",
      request: null,
    });
  } catch (error) {
    console.error("Error in GET /rooms/:roomId/join-request:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to fetch join request status" });
  }
});

/**
 * POST /api/v1/rooms/:roomId/cancel
 * Host removes / cancels room
 */
roomRouter.post("/:roomId/cancel", requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const roomId = req.params.roomId as string;
    const hostId = req.userId!;

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        attendances: true,
        joinRequests: {
          where: {
            status: { in: ["ACCEPTED", "CONFIRMED"] },
          },
          include: {
            payments: true,
          },
        },
      },
    });

    if (!room) {
      res.status(404).json({ success: false, error: "Not Found", message: "Room not found" });
      return;
    }

    if (room.hostId !== hostId) {
      res.status(403).json({ success: false, error: "Forbidden", message: "Only the host can cancel this room" });
      return;
    }

    if (room.status === "CANCELLED") {
      res.status(400).json({ success: false, error: "Bad Request", message: "Room is already cancelled" });
      return;
    }

    if (room.status === "COMPLETED") {
      res.status(400).json({ success: false, error: "Bad Request", message: "Cannot cancel a completed room" });
      return;
    }

    if (room.attendances && room.attendances.length > 0) {
      res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "Cannot cancel dinner room after participants have already checked in.",
      });
      return;
    }

    // Collect all successful payments for confirmed joinees
    const successfulPayments: { payment: any; joineeId: string }[] = [];
    for (const req of room.joinRequests) {
      for (const p of req.payments) {
        if (p.status === "SUCCESS") {
          successfulPayments.push({ payment: p, joineeId: req.joineeId });
        }
      }
    }

    const hasPaidJoinees = successfulPayments.length > 0;

    await prisma.$transaction(async (tx) => {
      // 1. Mark room as CANCELLED
      await tx.room.update({
        where: { id: roomId },
        data: { status: "CANCELLED" },
      });

      // 2. Mark active join requests as CANCELLED
      await tx.joinRequest.updateMany({
        where: {
          roomId: roomId,
          status: { in: ["PENDING", "ACCEPTED", "CONFIRMED"] },
        },
        data: { status: "CANCELLED" },
      });

      if (hasPaidJoinees) {
        // 3. Apply Host Penalty (-0.25)
        await tx.penalty.upsert({
          where: {
            userId_roomId_type: {
              userId: hostId,
              roomId: roomId,
              type: "HOST_CANCEL_AFTER_JOIN",
            },
          },
          create: {
            userId: hostId,
            roomId: roomId,
            type: "HOST_CANCEL_AFTER_JOIN",
            deduction: 0.25,
            reason: "Cancelled room after confirmed joinees joined",
          },
          update: {},
        });

        // 4. Process 70% refund for each paid joinee
        for (const item of successfulPayments) {
          const { payment, joineeId } = item;
          const refundAmount = Math.floor(payment.amount * 0.70);

          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: "REFUNDED",
              refundAmount,
              refundStatus: "REFUNDED",
              refundedAt: new Date(),
            },
          });

          // Notification for Joinee
          await tx.notification.create({
            data: {
              userId: joineeId,
              type: "ROOM_CANCELLED_HOST",
              title: "Dinner Room Cancelled",
              message: `The host cancelled "${room.title}". A demo refund of ₹${refundAmount} (70%) has been credited to your account.`,
              roomId: room.id,
              relatedUserId: hostId,
              relatedPaymentId: payment.id,
            },
          });
        }
      }

      // 5. Notify unpaid pending/accepted joinees that the room was cancelled
      const paidUserIds = new Set(successfulPayments.map((p) => p.joineeId));
      for (const req of room.joinRequests) {
        if (!paidUserIds.has(req.joineeId)) {
          await tx.notification.create({
            data: {
              userId: req.joineeId,
              type: "ROOM_CANCELLED_HOST",
              title: "Dinner Room Cancelled",
              message: `The host cancelled "${room.title}".`,
              roomId: room.id,
              relatedUserId: hostId,
            },
          });
        }
      }
    });

    res.status(200).json({
      success: true,
      message: hasPaidJoinees
        ? "Room cancelled successfully. Host penalty (-0.25) applied and 70% demo refund processed for joinees."
        : "Room cancelled successfully. No joinees were affected.",
      hostPenaltyApplied: hasPaidJoinees,
      refundedCount: successfulPayments.length,
    });
  } catch (error) {
    console.error("Error in POST /rooms/:roomId/cancel:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", message: "Failed to cancel room" });
  }
});


