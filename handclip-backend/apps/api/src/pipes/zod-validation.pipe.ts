import { PipeTransform, BadRequestException } from '@nestjs/common';
import { ZodSchema, ZodIssue } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const messages = result.error.issues
        .map((i: ZodIssue) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new BadRequestException(`Validation failed: ${messages}`);
    }
    return result.data;
  }
}
