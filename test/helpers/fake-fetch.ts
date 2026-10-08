import type { FetchImplementation, JSONWebKeySet } from "jose";

/** A jose customFetch that serves a JWKS and records every URL it was asked for. */
export function fakeJwksFetch(jwks: JSONWebKeySet): { fetch: FetchImplementation; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetch: async (url) => {
      urls.push(url);
      return Response.json(jwks);
    },
  };
}
