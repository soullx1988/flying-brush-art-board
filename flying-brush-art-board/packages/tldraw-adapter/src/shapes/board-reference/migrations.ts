import {
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
} from 'tldraw'

const Versions = createShapePropsMigrationIds('board-reference', {
  AddPreviewMode: 1,
})

export { Versions as boardReferenceShapeVersions }

/**
 * Schema-aware legacy snapshots become explicit content previews. Raw legacy
 * snapshots remain readable because the validator also accepts a missing prop.
 */
export const boardReferenceShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: Versions.AddPreviewMode,
      up: (props) => {
        if (props.previewMode === undefined) props.previewMode = 'content'
      },
      down: (props) => {
        delete props.previewMode
      },
    },
  ],
})
