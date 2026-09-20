/**
 * Typed surface over the shared pure-JS core (lib/embeddings-core.mjs) so the
 * same embedding algorithm backs both the app and the node scripts.
 */
export {
  EMBEDDING_DIM,
  EMBEDDING_PROVIDER,
  chunkText,
  hashEmbed,
  embedTexts,
  embedOne,
} from "./embeddings-core.mjs";
