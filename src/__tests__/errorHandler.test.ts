import { createAppError } from '../middleware/errorHandler';

describe('Error Handler', () => {
  it('should create an AppError with correct properties', () => {
    const error = createAppError('Not found', 404, 'NOT_FOUND');
    expect(error.message).toBe('Not found');
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.isOperational).toBe(true);
  });

  it('should create operational errors', () => {
    const error = createAppError('Bad request', 400, 'BAD_REQUEST');
    expect(error.isOperational).toBe(true);
  });
});
