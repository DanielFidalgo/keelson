// Admin commands fail for reasons the operator can fix, so they get the message and an exit code rather than a stack trace.
export async function runCommand(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
