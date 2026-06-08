import {
  ApiKeyConnectionBodySchema,
  OpenAiCompatibleConnectionBodySchema,
} from './ai-connections.dto';

describe('AI connection DTOs', () => {
  it('rejects whitespace-only API key payloads', () => {
    expect(
      ApiKeyConnectionBodySchema.safeParse({
        apiKey: '   ',
        model: 'gpt-4o-mini',
      }).success,
    ).toBe(false);

    expect(
      ApiKeyConnectionBodySchema.safeParse({
        apiKey: 'sk-test',
        model: '   ',
      }).success,
    ).toBe(false);
  });

  it('normalizes API key payload whitespace', () => {
    const parsed = ApiKeyConnectionBodySchema.parse({
      apiKey: '  sk-test  ',
      model: '  gpt-4o-mini  ',
    });

    expect(parsed).toEqual({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    });
  });

  it('normalizes OpenAI-compatible payload whitespace', () => {
    const parsed = OpenAiCompatibleConnectionBodySchema.parse({
      apiKey: '  sk-local  ',
      model: '  llama-3.1-8b  ',
      baseUrl: '  http://localhost:11434/v1  ',
    });

    expect(parsed).toEqual({
      apiKey: 'sk-local',
      model: 'llama-3.1-8b',
      baseUrl: 'http://localhost:11434/v1',
    });
  });
});
