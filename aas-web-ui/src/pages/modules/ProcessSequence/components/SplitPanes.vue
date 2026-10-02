<template>
  <div ref="containerElement" class="split-panes" :class="{ 'split-panes--right-collapsed': isRightCollapsed }">
    <div
      class="split-pane"
      :style="{ flexBasis: `${sizes[0]}%`, maxWidth: `${sizes[0]}%` }"
    >
      <slot name="left" />
    </div>

    <div
      :aria-label="`Resize the ${leftLabel}`"
      aria-orientation="vertical"
      :aria-valuemax="100 - minPane * 2"
      :aria-valuemin="minPane"
      :aria-valuenow="sizes[0]"
      class="split-handle"
      role="separator"
      tabindex="0"
      @dblclick="reset"
      @keydown="onKey(0, $event)"
      @pointerdown="startDrag(0, $event)"
    />

    <div
      class="split-pane split-pane--main"
      :style="isRightCollapsed ? { flexBasis: 'auto', maxWidth: 'none' } : { flexBasis: `${sizes[1]}%`, maxWidth: `${sizes[1]}%` }"
    >
      <slot />
    </div>

    <template v-if="!isRightCollapsed">
      <div
        :aria-label="`Resize the ${rightLabel}`"
        aria-orientation="vertical"
        :aria-valuemax="100 - minPane * 2"
        :aria-valuemin="minPane"
        :aria-valuenow="sizes[2]"
        class="split-handle"
        role="separator"
        tabindex="0"
        @dblclick="reset"
        @keydown="onKey(1, $event)"
        @pointerdown="startDrag(1, $event)"
      />

      <div
        class="split-pane"
        :style="{ flexBasis: `${sizes[2]}%`, maxWidth: `${sizes[2]}%` }"
      >
        <slot name="right" />
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
  /**
   * Three resizable columns with a collapsible right column.
   *
   * Vuetify has no splitter, and a three pane editor is the one place a hand written one is worth it:
   * the handles are keyboard operable, they respect a minimum so no pane can be lost, and the sizes
   * are remembered so the layout is the same the next time the module is opened.
   *
   * The columns are sized as percentages of the container so the layout survives a window resize,
   * and the centre column absorbs the difference when the right column is collapsed.
   */

  const MIN_PANE = 12
  const KEYBOARD_STEP = 2
  const DEFAULT_SIZES: [number, number, number] = [20, 55, 25]

  const props = withDefaults(defineProps<{
    leftLabel?: string
    rightLabel?: string
    /** Key the sizes are remembered under, so each module keeps its own layout. */
    storageKey?: string
  }>(), {
    leftLabel: 'left panel',
    rightLabel: 'right panel',
    storageKey: 'processSequence.splitSizes',
  })

  const emit = defineEmits<{ 'update:right-collapsed': [collapsed: boolean] }>()

  const isRightCollapsed = ref(false)
  const sizes = ref<[number, number, number]>([...DEFAULT_SIZES])

  const minPane = computed(() => (isRightCollapsed.value ? 10 : MIN_PANE))

  function readStored (): void {
    try {
      const stored = localStorage.getItem(props.storageKey)
      if (stored === null) {
        return
      }
      const parsed = JSON.parse(stored) as unknown
      if (Array.isArray(parsed) && parsed.length === 3 && parsed.every(value => typeof value === 'number')) {
        sizes.value = [parsed[0] as number, parsed[1] as number, parsed[2] as number]
        clampAll()
      }
    } catch {
      // A corrupt or unreadable entry is not worth failing a layout over; the defaults are fine.
    }
  }

  function store (): void {
    try {
      localStorage.setItem(props.storageKey, JSON.stringify(sizes.value))
    } catch {
      // Private browsing, or a full quota. The layout simply will not be remembered.
    }
  }

  /** Keep every pane at or above the minimum by taking the space from the widest neighbour. */
  function clampAll (): void {
    const [left, main, right] = sizes.value
    const minimum = MIN_PANE
    const total = left + main + right
    if (total === 100 && left >= minimum && main >= minimum && right >= minimum) {
      return
    }

    const corrected = [left, main, right].map(value => Math.max(minimum, Math.round(value)))
    // Redistribute the rounding difference over the middle pane, which is the only one that can
    // grow without a pane becoming unreadable.
    const difference = 100 - corrected.reduce((sum, value) => sum + value, 0)
    corrected[1] = Math.max(minimum, corrected[1] + difference)
    sizes.value = [corrected[0] as number, corrected[1] as number, corrected[2] as number]
  }

  /**
   * Move the divider at `index`, which sits between pane `index` and the one after it.
   * The two panes either side share the movement, and the third is untouched.
   */
  function moveDivider (index: number, deltaPercent: number): void {
    const next = [...sizes.value] as [number, number, number]
    const a = Math.max(minPane.value, next[index] + deltaPercent)
    const b = next[index + 1] - (a - next[index])
    if (b < minPane.value) {
      return
    }
    next[index] = a
    next[index + 1] = b
    sizes.value = next
    store()
  }

  let dragging: { index: number, startX: number, startSizes: [number, number, number] } | null = null

  function startDrag (index: number, event: PointerEvent): void {
    dragging = { index, startX: event.clientX, startSizes: [...sizes.value] as [number, number, number] }
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', endDrag, { once: true })
  }

  function onDragMove (event: PointerEvent): void {
    if (!dragging) {
      return
    }
    const container = containerElement.value
    if (!container) {
      return
    }

    const width = container.getBoundingClientRect().width
    if (width === 0) {
      return
    }

    const deltaPercent = ((event.clientX - dragging.startX) / width) * 100
    const next = [...dragging.startSizes] as [number, number, number]
    const index = dragging.index

    const a = Math.max(minPane.value, next[index] + deltaPercent)
    const b = next[index + 1] - (a - next[index])
    if (b < minPane.value) {
      return
    }
    next[index] = a
    next[index + 1] = b
    sizes.value = next
  }

  function endDrag (): void {
    dragging = null
    window.removeEventListener('pointermove', onDragMove)
    store()
  }

  function onKey (index: number, event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') {
      moveDivider(index, -KEYBOARD_STEP)
      event.preventDefault()
    } else if (event.key === 'ArrowRight') {
      moveDivider(index, KEYBOARD_STEP)
      event.preventDefault()
    }
  }

  function reset (): void {
    sizes.value = [...DEFAULT_SIZES]
    store()
  }

  function toggleRight (): void {
    isRightCollapsed.value = !isRightCollapsed.value
    emit('update:right-collapsed', isRightCollapsed.value)
    if (!isRightCollapsed.value) {
      clampAll()
      store()
    }
  }

  const containerElement = ref<HTMLElement | null>(null)

  onMounted(readStored)
  onBeforeUnmount(() => {
    window.removeEventListener('pointermove', onDragMove)
  })

  defineExpose({ reset, toggleRight, sizes })
</script>

<style scoped>
  .split-panes {
    display: flex;
    align-items: stretch;
    height: 100%;
    min-height: 0;
    width: 100%;
  }

  .split-pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .split-pane--main {
    flex-grow: 1;
    flex-shrink: 1;
  }

  .split-handle {
    flex: 0 0 6px;
    cursor: col-resize;
    background: transparent;
    border: none;
    position: relative;
    z-index: 1;
  }

  .split-handle::after {
    content: '';
    position: absolute;
    inset: 0 2px;
    border-radius: 2px;
    background: rgba(128, 128, 128, 0.25);
    transition: background 0.12s ease-in-out;
  }

  .split-handle:hover::after,
  .split-handle:focus-visible::after {
    background: rgb(var(--v-theme-primary));
  }

  .split-handle:focus-visible {
    outline: none;
  }
</style>
