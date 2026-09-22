# Testing Guide

## Test Commands

```bash
# Run all unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run integration tests
npm run test:integration

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test -- src/__tests__/auth.test.ts
```

## Test Structure

### Unit Tests
- `src/__tests__/crypto.test.ts` - Password hashing, tokens
- `src/__tests__/validators.test.ts` - Input validation
- `src/__tests__/errorHandler.test.ts` - Error handling
- `src/__tests__/auth.test.ts` - Authentication logic
- `src/__tests__/claim.test.ts` - Claim processing
- `src/__tests__/security.test.ts` - Security controls

### Integration Tests
- Registration and verification flow
- Login and logout flow
- Receipt upload and review flow
- Points crediting flow
- Redemption flow

## Writing Tests

### Unit Test Example
```typescript
describe('Feature', () => {
  it('should do something', () => {
    const result = doSomething(input);
    expect(result).toBe(expected);
  });
});
```

### Integration Test Example
```typescript
describe('API Endpoint', () => {
  it('should handle request', async () => {
    const response = await request(app)
      .post('/api/endpoint')
      .send(data)
      .expect(200);
    
    expect(response.body).toHaveProperty('id');
  });
});
```

## Coverage Requirements

- Statements: 80%
- Branches: 75%
- Functions: 80%
- Lines: 80%

## Acceptance Tests

### Manual Testing Checklist
1. Customer registration
2. Email verification
3. Receipt upload
4. Admin review
5. Points crediting
6. Redemption request
7. Voucher usage
8. Password reset
9. Profile update
10. Mobile responsiveness
