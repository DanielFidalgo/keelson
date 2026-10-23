export interface InternalRequestVerifier {
  // Bad credentials are an answer, not an error: implementations resolve false and never throw for them.
  verify(authorizationHeader: string | undefined): Promise<boolean>;
}
