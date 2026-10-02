import validator from "validator";

export function verifyPassword(password: string): boolean {
  return validator.isStrongPassword(password);
}

export function verifyEmail(email: string): boolean {
  return validator.isEmail(email);
}

export function verifyPhone(phone: string): boolean {
  return validator.isMobilePhone(phone, ["en-US", "zh-CN"]);
}
