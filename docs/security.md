# Security

## Threat Model

### External Threats
1. **Unauthorized Access**
   - Mitigation: Session authentication, RBAC
   - Testing: IDOR tests, role-based access tests

2. **Data Breach**
   - Mitigation: Password hashing, encrypted connections
   - Testing: Password storage tests, HTTPS enforcement

3. **File Upload Abuse**
   - Mitigation: MIME validation, size limits, private storage
   - Testing: Upload security tests

4. **Injection Attacks**
   - Mitigation: Parameterized queries, input validation
   - Testing: SQL injection tests, XSS tests

### Internal Threats
1. **Privilege Escalation**
   - Mitigation: Role-based authorization, resource-level checks
   - Testing: Authorization tests for each role

2. **Data Tampering**
   - Mitigation: Audit logging, append-only ledger
   - Testing: Ledger integrity tests

## Controls

### Authentication
- Argon2id password hashing
- Session-based authentication
- HTTP-only, Secure cookies
- CSRF protection
- Rate limiting on auth endpoints

### Authorization
- Role-based access control (RBAC)
- Resource-level authorization
- Customer can only access own data
- Admin roles: reviewer, manager, master_admin

### Input Validation
- Zod schema validation
- Parameterized SQL queries
- File type validation
- Size limits

### Data Protection
- Passwords never logged
- Receipt images in private storage
- Sensitive data masked in errors
- Environment variables for secrets

### Monitoring
- Audit logging for all state changes
- Failed login attempt tracking
- Request ID tracking
- Structured logging

## Testing Checklist

### Authentication Tests
- [ ] Password hashing with argon2id
- [ ] Session creation and destruction
- [ ] Password reset token expiry
- [ ] OTP verification limits

### Authorization Tests
- [ ] Customer cannot access other customer's data
- [ ] Reviewer cannot modify rules
- [ ] Master admin permissions work correctly
- [ ] Unauthenticated access rejected

### Input Validation Tests
- [ ] SQL injection payloads rejected
- [ ] XSS in user inputs prevented
- [ ] File upload type validation
- [ ] File size limits enforced

### Security Tests
- [ ] Rate limiting works
- [ ] CSRF protection enabled
- [ ] Secure headers present
- [ ] HTTPS enforced
