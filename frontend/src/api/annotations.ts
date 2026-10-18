/**
 * Annotation endpoints (time-stamped sticky notes on an entry).
 */
import { apiJson, apiVoid } from './client';
import type { Annotation, AnnotationCreateInput, AnnotationPatch } from './types';

interface AnnotationEnvelope {
  annotation: Annotation;
}

function annotationsPath(entryId: number, id?: number): string {
  const base = `/entries/${String(entryId)}/annotations`;
  return id === undefined ? base : `${base}/${String(id)}`;
}

/**
 * Lists an entry's annotations, sorted by `start_ms` then `id`.
 *
 * @param entryId - The entry id.
 * @param signal - Aborts the request.
 * @returns The annotations.
 */
export async function listAnnotations(
  entryId: number,
  signal?: AbortSignal,
): Promise<Annotation[]> {
  const body = await apiJson(annotationsPath(entryId), { signal });
  return (body as { annotations: Annotation[] }).annotations;
}

/**
 * Adds an annotation.
 *
 * @param entryId - The entry id.
 * @param input - Start (and optional end) in ms, body and color.
 * @returns The created annotation.
 * @throws ApiError `422 annotation_limit_reached` when the entry already has 200 notes.
 */
export async function createAnnotation(
  entryId: number,
  input: AnnotationCreateInput,
): Promise<Annotation> {
  const body = await apiJson(annotationsPath(entryId), { method: 'POST', body: input });
  return (body as AnnotationEnvelope).annotation;
}

/**
 * Updates an annotation.
 *
 * @param entryId - The entry id.
 * @param id - The annotation id.
 * @param patch - The fields to change; `end_ms: null` makes it a point note.
 * @returns The updated annotation.
 */
export async function updateAnnotation(
  entryId: number,
  id: number,
  patch: AnnotationPatch,
): Promise<Annotation> {
  const body = await apiJson(annotationsPath(entryId, id), { method: 'PATCH', body: patch });
  return (body as AnnotationEnvelope).annotation;
}

/**
 * Deletes an annotation.
 *
 * @param entryId - The entry id.
 * @param id - The annotation id.
 */
export async function deleteAnnotation(entryId: number, id: number): Promise<void> {
  await apiVoid(annotationsPath(entryId, id), { method: 'DELETE' });
}
