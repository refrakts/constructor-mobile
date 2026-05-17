/**
 * Reasoning-effort selector (sessions/create slice). Rendered only when the
 * chosen model supports reasoning. Lists the model's valid efforts as tappable
 * Rows with a checkmark; an "Auto" row clears the selection (no field sent) for
 * models whose reasoning default is undefined (e.g. gpt-5.x base).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  getReasoningConfig,
  type ReasoningEffort,
  type ValidModel,
} from '@constructor/protocol';
import { Spacing } from '@/constants/theme';
import { Row, useThemeColors } from '@/ui';

const EFFORT_LABEL: Record<ReasoningEffort, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
};

export function effortLabel(effort: ReasoningEffort | undefined): string {
  return effort ? EFFORT_LABEL[effort] : 'Auto';
}

export function ReasoningSelector({
  model,
  value,
  onChange,
}: {
  model: ValidModel;
  value: ReasoningEffort | undefined;
  onChange: (effort: ReasoningEffort | undefined) => void;
}) {
  const c = useThemeColors();
  const config = getReasoningConfig(model);
  if (!config) return null;

  // "Auto" (undefined) is offered only when the model has no enforced default,
  // matching MODEL_REASONING_CONFIG where `default` is undefined.
  const showAuto = config.default === undefined;

  const renderRow = (
    effort: ReasoningEffort | undefined,
    label: string,
    last: boolean,
  ) => {
    const selected = value === effort;
    return (
      <Row key={label} last={last} onPress={() => onChange(effort)}>
        <View style={st.flex}>
          <Text style={[st.optTitle, { color: selected ? '#208AEF' : c.text }]}>
            {label}
          </Text>
        </View>
        {selected ? <Text style={st.check}>{'✓'}</Text> : null}
      </Row>
    );
  };

  return (
    <View>
      {showAuto ? renderRow(undefined, 'Auto', false) : null}
      {config.efforts.map((effort, i) =>
        renderRow(
          effort,
          EFFORT_LABEL[effort],
          i === config.efforts.length - 1,
        ),
      )}
    </View>
  );
}

const st = StyleSheet.create({
  flex: { flex: 1 },
  optTitle: { fontSize: 16, fontWeight: '500' },
  check: { fontSize: 17, fontWeight: '700', color: '#208AEF', marginLeft: Spacing.two },
});
