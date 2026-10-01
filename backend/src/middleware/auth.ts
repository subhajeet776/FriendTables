import { Request, Response, NextFunction } from "express";
import { verifyToken, JwtPayload } from "../utils/jwt.js";
import { prisma } from "../db.js";

export interface AuthenticatedRequest extends Request {
  user?: any;
  userId?: string;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        success: false,
        error: "Unauthorized",
        message: "Missing or invalid Authorization header",
      });
      return;
    }

    const token = authHeader.split(" ")[1];
    const decoded: JwtPayload = verifyToken(token);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        error: "Unauthorized",
        message: "User not found or session expired",
      });
      return;
    }

    req.user = user;
    req.userId = user.id;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      error: "Unauthorized",
      message: "Invalid or expired token",
    });
  }
}
