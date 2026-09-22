import React from 'react';
import { View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

interface TrendChartProps {
  seriesA: number[];
  seriesB: number[];
  colorA?: string;
  colorB?: string;
  height?: number;
  width?: number;
}

function toPoints(values: number[], max: number, width: number, height: number): string {
  if (values.length === 0) return '';
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = i * step;
      const y = max > 0 ? height - (v / max) * height : height;
      return `${x},${y}`;
    })
    .join(' ');
}

/** Minimal dependency-free line chart on react-native-svg (already linked) -- avoids chart libraries that pull in unrelated native modules. */
export function TrendChart({ seriesA, seriesB, colorA = '#25D366', colorB = '#3b82f6', height = 120, width = 300 }: TrendChartProps) {
  const max = Math.max(1, ...seriesA, ...seriesB);
  const padding = 4;
  const innerHeight = height - padding * 2;

  return (
    <View style={{ height, width: '100%' }}>
      <Svg height={height} width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <Polyline
          points={toPoints(seriesA, max, width, innerHeight)}
          fill="none"
          stroke={colorA}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          transform={`translate(0, ${padding})`}
        />
        <Polyline
          points={toPoints(seriesB, max, width, innerHeight)}
          fill="none"
          stroke={colorB}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          transform={`translate(0, ${padding})`}
        />
      </Svg>
    </View>
  );
}
