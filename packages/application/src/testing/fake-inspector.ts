import type { Inspection, InspectionTarget, McpInspector } from '../ports.js';

export class FakeInspector implements McpInspector {
  readonly targets: InspectionTarget[] = [];
  private readonly responses: Inspection[] = [];

  respondWith(...inspections: Inspection[]): void {
    this.responses.push(...inspections);
  }

  inspect(target: InspectionTarget): Promise<Inspection> {
    this.targets.push(target);
    const response = this.responses.shift();
    // A silent default would let a test pass without scripting the server it claims to exercise.
    if (response === undefined) return Promise.reject(new Error('FakeInspector has no scripted response left'));
    return Promise.resolve(response);
  }
}
