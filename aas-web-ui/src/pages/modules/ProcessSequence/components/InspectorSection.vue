<template>
  <section :aria-label="title" class="inspector-section rounded-lg mb-3" :style="{ '--section-color': `var(--v-theme-${color})` }">
    <div class="section-header d-flex align-center flex-wrap ga-1 px-3 py-2">
      <v-btn
        v-if="collapsible"
        :aria-controls="contentId"
        :aria-expanded="expanded"
        :aria-label="`${expanded ? 'Collapse' : 'Expand'} ${title}`"
        class="px-0 text-none font-weight-bold"
        :prepend-icon="expanded ? 'mdi-chevron-down' : 'mdi-chevron-right'"
        size="small"
        variant="text"
        @click="expanded = !expanded"
      >{{ title }}</v-btn>

      <span v-else class="text-body-small font-weight-bold">{{ title }}</span>

      <v-tooltip
        v-if="help"
        location="top"
        max-width="320"
        open-on-click
        :text="help"
      >
        <template #activator="{ props: activator }">
          <v-btn
            v-bind="activator"
            :aria-label="`${title} help`"
            icon="mdi-information-outline"
            size="x-small"
            variant="text"
          />
        </template>
      </v-tooltip>

      <v-spacer />
      <slot name="actions" />
    </div>

    <div v-show="expanded" :id="contentId" class="pa-3"><slot /></div>
  </section>
</template>

<script setup lang="ts">
  withDefaults(defineProps<{ title: string, help?: string, color?: string, collapsible?: boolean }>(), { help: '', color: 'primary', collapsible: false })
  const expanded = ref(true)
  const contentId = useId()
</script>

<style scoped>
.inspector-section {
  border: 1px solid rgba(var(--section-color), 0.25);
  border-left: 3px solid rgb(var(--section-color));
  overflow: hidden;
}
.section-header {
  background: rgba(var(--section-color), 0.1);
}
</style>
