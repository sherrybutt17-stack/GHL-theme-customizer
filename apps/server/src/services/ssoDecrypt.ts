import CryptoJS from "crypto-js";

export interface GhlUserContext {
  userId: string;
  companyId: string;
  role: string;
  type: string;
  activeLocation: string;
  userName: string;
  email: string;
  isAgencyOwner: boolean;
}

/**
 * Decrypts the payload from GHL's REQUEST_USER_DATA_RESPONSE postMessage.
 * Must only ever run server-side - the Shared Secret Key never reaches the browser.
 */
export function decryptUserContext(encryptedPayload: string): GhlUserContext {
  const sharedSecret = process.env.GHL_APP_SHARED_SECRET;
  if (!sharedSecret) {
    throw new Error("Missing GHL_APP_SHARED_SECRET env var, cannot decrypt SSO payload");
  }
  const bytes = CryptoJS.AES.decrypt(encryptedPayload, sharedSecret);
  const json = bytes.toString(CryptoJS.enc.Utf8);
  if (!json) {
    throw new Error("Failed to decrypt SSO payload - empty result (wrong shared secret?)");
  }
  return JSON.parse(json);
}
