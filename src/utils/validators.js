const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isStr = (v) => typeof v === 'string';

export function validateRegister(body) {
  const { name, email, password } = body ?? {};
  const errors = {};
  if (!isStr(name) || name.trim().length < 2 || name.trim().length > 60) errors.name = 'Name must be 2 to 60 characters.';
  if (!isStr(email) || !EMAIL.test(email.trim())) errors.email = 'Enter a valid email address.';
  // bcrypt hashes at most 72 *bytes*, not characters, and silently ignores the rest.
  // Measuring bytes keeps multi-byte characters from being truncated without warning.
  if (!isStr(password) || Buffer.byteLength(password, 'utf8') > 72 || password.length < 8) {
    errors.password = 'Password must be at least 8 characters and at most 72 bytes long.';
  }
  return errors;
}

export function validateLogin(body) {
  const { email, password } = body ?? {};
  const errors = {};
  if (!isStr(email) || !EMAIL.test(email.trim())) errors.email = 'Enter a valid email address.';
  if (!isStr(password) || password.length === 0) errors.password = 'Password is required.';
  return errors;
}
