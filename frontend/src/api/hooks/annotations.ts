/**
 * Mutation hooks for the owner's annotations. Each one updates
 * `['users', me.username, 'entry', entryId].annotations` (kept sorted by `start_ms` then `id`)
 * and invalidates the owner's entry lists so `annotation_count` stays correct.
 */
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { createAnnotation, deleteAnnotation, updateAnnotation } from '../annotations';
import { queryKeys } from '../keys';
import type { Annotation, AnnotationCreateInput, AnnotationPatch, EntryDetail } from '../types';
import { ownerEntriesKey, ownerUsername } from './owner';

/**
 * Sorts annotations the way the API does.
 *
 * @param annotations - Annotations in any order.
 * @returns A new array sorted by `start_ms`, then `id`.
 */
export function sortAnnotations(annotations: readonly Annotation[]): Annotation[] {
  return annotations.toSorted((a, b) => a.start_ms - b.start_ms || a.id - b.id);
}

async function annotationsChanged(
  queryClient: QueryClient,
  entryId: number,
  change: (annotations: Annotation[]) => Annotation[],
): Promise<void> {
  const username = ownerUsername(queryClient);
  if (username !== null) {
    queryClient.setQueryData<EntryDetail>(queryKeys.entry(username, entryId), (entry) => {
      if (entry === undefined) {
        return undefined;
      }
      const annotations = sortAnnotations(change(entry.annotations));
      return { ...entry, annotations, annotation_count: annotations.length };
    });
  }
  await queryClient.invalidateQueries({ queryKey: ownerEntriesKey(queryClient) });
}

/** Variables of {@link useCreateAnnotation}. */
export interface CreateAnnotationVariables {
  entryId: number;
  input: AnnotationCreateInput;
}

/** Adds an annotation to an entry. */
export function useCreateAnnotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, input }: CreateAnnotationVariables) => createAnnotation(entryId, input),
    onSuccess: (annotation, { entryId }) =>
      annotationsChanged(queryClient, entryId, (annotations) => [...annotations, annotation]),
  });
}

/** Variables of {@link useUpdateAnnotation}. */
export interface UpdateAnnotationVariables {
  entryId: number;
  id: number;
  patch: AnnotationPatch;
}

/** Updates an annotation. */
export function useUpdateAnnotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, id, patch }: UpdateAnnotationVariables) =>
      updateAnnotation(entryId, id, patch),
    onSuccess: (annotation, { entryId }) =>
      annotationsChanged(queryClient, entryId, (annotations) =>
        annotations.map((existing) => (existing.id === annotation.id ? annotation : existing)),
      ),
  });
}

/** Variables of {@link useDeleteAnnotation}. */
export interface DeleteAnnotationVariables {
  entryId: number;
  id: number;
}

/** Deletes an annotation. */
export function useDeleteAnnotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, id }: DeleteAnnotationVariables) => deleteAnnotation(entryId, id),
    onSuccess: (_data, { entryId, id }) =>
      annotationsChanged(queryClient, entryId, (annotations) =>
        annotations.filter((annotation) => annotation.id !== id),
      ),
  });
}
