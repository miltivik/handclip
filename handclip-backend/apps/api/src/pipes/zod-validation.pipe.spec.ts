import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

const schema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0),
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('passes valid data through with the parsed (typed) value', () => {
    const result = pipe.transform({ email: 'a@b.co', age: 3 });
    expect(result).toEqual({ email: 'a@b.co', age: 3 });
  });

  it('throws BadRequestException with a readable message on invalid data', () => {
    expect(() => pipe.transform({ email: 'not-an-email', age: -1 })).toThrow(BadRequestException);
    try {
      pipe.transform({ email: 'not-an-email', age: -1 });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/Validation failed/);
      expect(msg).toMatch(/email/);
      expect(msg).toMatch(/age/);
    }
  });
});
