/**
 * Native model selector (sessions/create slice). A disclosure Row that expands
 * an inline, grouped, tappable list with a checkmark on the active model — no
 * picker library. Options come from the frozen `@constructor/protocol`.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MODEL_OPTIONS, type ValidModel } from '@constructor/protocol';
import { Spacing } from '@/constants/theme';
import { Row, useThemeColors } from '@/ui';

function modelName(id: ValidModel): string {
  for (const group of MODEL_OPTIONS) {
    const found = group.models.find((m) => m.id === id);
    if (found) return found.name;
  }
  return id;
}

export function ModelSelector({
  value,
  onChange,
}: {
  value: ValidModel;
  onChange: (model: ValidModel) => void;
}) {
  const c = useThemeColors();
  const [open, setOpen] = useState(false);

  return (
    <View>
      <Row onPress={() => setOpen((o) => !o)} last={!open}>
        <View style={st.flex}>
          <Text style={[st.title, { color: c.text }]}>Model</Text>
        </View>
        <Text style={[st.value, { color: c.textSecondary }]} numberOfLines={1}>
          {modelName(value)}
        </Text>
        <Text style={[st.chevron, { color: c.textSecondary }]}>{open ? '⌄' : '›'}</Text>
      </Row>

      {open ? (
        <View>
          {MODEL_OPTIONS.map((group, gi) => (
            <View key={group.category}>
              <View style={[st.groupHeader, { backgroundColor: c.backgroundSelected }]}>
                <Text style={[st.groupTitle, { color: c.textSecondary }]}>
                  {group.category.toUpperCase()}
                </Text>
              </View>
              {group.models.map((m, mi) => {
                const selected = m.id === value;
                const isLastRow =
                  gi === MODEL_OPTIONS.length - 1 && mi === group.models.length - 1;
                return (
                  <Row
                    key={m.id}
                    last={isLastRow}
                    onPress={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                  >
                    <View style={st.flex}>
                      <Text
                        style={[
                          st.optTitle,
                          { color: selected ? '#208AEF' : c.text },
                        ]}
                      >
                        {m.name}
                      </Text>
                      <Text style={[st.optSub, { color: c.textSecondary }]}>
                        {m.description}
                      </Text>
                    </View>
                    {selected ? (
                      <Text style={st.check}>{'✓'}</Text>
                    ) : null}
                  </Row>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  flex: { flex: 1 },
  title: { fontSize: 16, fontWeight: '500' },
  value: { fontSize: 16, maxWidth: 180, textAlign: 'right' },
  chevron: { fontSize: 18, marginLeft: Spacing.two },
  groupHeader: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  groupTitle: { fontSize: 12, fontWeight: '600' },
  optTitle: { fontSize: 16, fontWeight: '500' },
  optSub: { fontSize: 13, marginTop: 2 },
  check: { fontSize: 17, fontWeight: '700', color: '#208AEF', marginLeft: Spacing.two },
});
