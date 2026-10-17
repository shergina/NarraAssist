// Owner: Person 4. Signs Zoom Meeting SDK join tokens so the secret never reaches the browser.
// Mounted at /api/zoom in server/index.js.
import { Router } from "express";
import crypto from "node:crypto";
import { HttpError } from "./errors.js";

export const zoomRouter = Router();

const b64url = (text) => Buffer.from(text).toString("base64url");

// Builds the signed token the Meeting SDK needs to join. Role 0 = attendee,
// which is what the Accessibility helper always is.
export function signMeetingToken({ sdkKey, sdkSecret, meetingNumber, role = 0, now = Date.now() }) {
  const iat = Math.floor(now / 1000) - 30;
  const exp = iat + 60 * 60 * 2; // Zoom accepts 30 minutes to 48 hours
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      appKey: sdkKey, // older SDK versions read this name
      sdkKey, // newer ones read this one
      mn: Number(meetingNumber),
      role,
      iat,
      exp,
      tokenExp: exp,
    }),
  );
  const signature = crypto.createHmac("sha256", sdkSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

// POST /api/zoom/signature  { meetingNumber } -> { signature, sdkKey }
zoomRouter.post("/signature", (req, res, next) => {
  try {
    const meetingNumber = String(req.body?.meetingNumber ?? "").replace(/[\s-]/g, "");
    if (!/^\d{9,11}$/.test(meetingNumber)) {
      throw new HttpError(400, "meetingNumber must be 9 to 11 digits.");
    }

    const sdkKey = process.env.ZOOM_SDK_KEY;
    const sdkSecret = process.env.ZOOM_SDK_SECRET;
    if (!sdkKey || !sdkSecret) {
      // Fail loudly. A fake token would only make Zoom reject the join with a vague error.
      throw new HttpError(503, "Zoom SDK keys are missing. Add ZOOM_SDK_KEY and ZOOM_SDK_SECRET to .env and restart the server.");
    }

    res.json({ signature: signMeetingToken({ sdkKey, sdkSecret, meetingNumber }), sdkKey });
  } catch (error) {
    next(error);
  }
});