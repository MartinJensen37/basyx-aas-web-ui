<template>
  <section :aria-label="title" class="inspector-section rounded-lg mb-3" :style="{ '--section-color': `var(--v-theme-${color})` }">
    <div class="section-header d-flex align-center flex-wrap ga-1 px-3 py-2">
      <span class="text-body-small font-weight-bold">{{ title }}</span>

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

    <div class="pa-3"><slot /></div>
  </section>
</template>

<script setup lang="ts">
  withDefaults(defineProps<{ title: string, help?: string, color?: string }>(), { help: '', color: 'primary' })
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
