// Owner: Person 4. Signs Zoom Meeting SDK join tokens so the secret never reaches the browser.
// Already mounted at /api/zoom in server/index.js, so Person 4 doesn't need to touch that file.
import { Router } from "express";
import { HttpError } from "./errors.js";

export const zoomRouter = Router();

// { meetingNumber } -> { signature, sdkKey }
zoomRouter.post("/signature", () => {
  throw new HttpError(501, "Zoom signing isn't built yet (Person 4).");
});
