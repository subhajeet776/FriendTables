import { maskPhoneNumber } from "../utils/phone.js";

export interface SendOtpResult {
  success: boolean;
  provider: "twilio" | "simulator";
  messageId?: string;
}

/**
 * Checks if real production SMS provider (Twilio) is configured with required credentials
 */
export function isSmsConfigured(): boolean {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  const hasCredentials = Boolean(accountSid && authToken && (fromNumber || messagingServiceSid));
  const isExplicitlyDisabled = process.env.SMS_PROVIDER === "simulator" || process.env.SMS_PROVIDER === "disabled";

  return hasCredentials && !isExplicitlyDisabled;
}

/**
 * Send an OTP code via SMS
 *
 * In production: Uses Twilio REST API with credentials from environment variables.
 * In development: If Twilio credentials are missing, falls back to a safe dev simulator.
 * Security: Raw OTP codes are NEVER logged to console or logs.
 */
export async function sendOtpSms(toPhone: string, otp: string): Promise<SendOtpResult> {
  const maskedPhone = maskPhoneNumber(toPhone);

  if (isSmsConfigured()) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID!;
    const authToken = process.env.TWILIO_AUTH_TOKEN!;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

    const messageBody = `Your Frientables verification code is: ${otp}. Valid for 5 minutes. Do not share this code with anyone.`;

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const params = new URLSearchParams();
    params.append("To", toPhone);
    params.append("Body", messageBody);

    if (messagingServiceSid) {
      params.append("MessagingServiceSid", messagingServiceSid);
    } else if (fromNumber) {
      params.append("From", fromNumber);
    }

    const authHeader = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      const data = (await response.json()) as any;

      if (!response.ok) {
        const errorMsg = data?.message || response.statusText;
        const errorCode = data?.code || response.status;
        console.error(
          `[SMS Service] Twilio delivery failed for ${maskedPhone}: status ${response.status}, code ${errorCode}, error: ${errorMsg}`
        );
        throw new Error(`SMS delivery failed (${errorCode}): ${errorMsg}`);
      }

      console.log(`[SMS Service] Twilio SMS dispatched successfully to ${maskedPhone} (SID: ${data.sid})`);
      return {
        success: true,
        provider: "twilio",
        messageId: data.sid,
      };
    } catch (err: any) {
      if (err.message && err.message.startsWith("SMS delivery failed")) {
        throw err;
      }
      console.error(`[SMS Service] Network error dispatching Twilio SMS to ${maskedPhone}:`, err.message);
      throw new Error("Unable to connect to SMS delivery provider. Please try again.");
    }
  }

  // Twilio credentials not configured
  if (process.env.NODE_ENV === "production") {
    console.error(
      `[SMS Service ERROR] Production SMS provider is unconfigured. TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER missing.`
    );
    throw new Error("SMS delivery service is not configured. Please contact support.");
  }

  // Local Development / Test Simulator
  // NOTE: Never log the raw OTP value! Only log masked phone to indicate dispatch.
  console.log(
    `[SMS Service Simulator] Mock SMS dispatched to ${maskedPhone}. (Twilio credentials not configured in .env)`
  );

  return {
    success: true,
    provider: "simulator",
  };
}
