export const SIGNUP_STORAGE_KEY = "aura_signup_data";

export type PendingSignupData = {
  full_name: string;
  business_name: string;
  phone: string; // já normalizado em E.164
  profession: string;
};
