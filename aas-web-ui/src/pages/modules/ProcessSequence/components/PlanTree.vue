<template>
  <v-card border class="h-100 overflow-y-auto" rounded="lg">
    <v-card-title class="text-body-large">Product structure</v-card-title>

    <v-text-field
      v-model="search"
      class="mx-3"
      density="compact"
      hide-details
      label="Find assembly or subprocess"
      prepend-inner-icon="mdi-magnify"
      variant="outlined"
    />

    <v-treeview
      activatable
      :activated="[selectedId]"
      density="compact"
      item-value="id"
      :items="items"
      open-all
      :search="search"
      @update:activated="select"
    >
      <template #prepend="{ item }">
        <v-icon :icon="item.icon" size="small" />
      </template>
    </v-treeview>
  </v-card>
</template>

<script setup lang="ts">
  import type { ProcessPlan } from '../types/plan'

  type TreeItem = { id: string, title: string, icon: string, children: TreeItem[] }

  const props = defineProps<{ plan: ProcessPlan, selectedId: string }>()
  const emit = defineEmits<{ select: [id: string] }>()
  const search = ref('')
  const items = computed(() => build(props.plan.rootScopeId))

  function build (id: string): TreeItem[] {
    const scope = props.plan.scopes.find(item => item.id === id)
    if (!scope) {
      return []
    }
    const children = props.plan.scopes.filter(item => item.parentId === id)
    const materials = children.filter(item => item.material).flatMap(item => build(item.id))
    const subprocesses = children.filter(item => !item.material).flatMap(item => build(item.id))
    return [{
      id, title: scope.name, icon: scope.material || scope.id === props.plan.rootScopeId ? 'mdi-package-variant-closed' : 'mdi-folder-play-outline',
      children: [...materials, ...(subprocesses.length > 0 ? [{ id: `group:${id}`, title: 'Subprocesses', icon: 'mdi-folder-outline', children: subprocesses }] : [])],
    }]
  }

  function select (ids: unknown[]): void {
    const id = String(ids[0] ?? '')
    if (props.plan.scopes.some(scope => scope.id === id)) {
      emit('select', id)
    }
  }
</script>
