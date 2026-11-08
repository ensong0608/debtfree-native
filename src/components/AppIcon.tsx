import { type StyleProp, type ViewStyle } from 'react-native';
import { View, appearanceColor, useNativeAppearance } from './NativeAppearance';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type NavigationTabIconName = 'home' | 'debt' | 'transactions' | 'budget' | 'progress';

export type AppIconName =
  | NavigationTabIconName
  | 'settings'
  | 'bell'
  | 'add'
  | 'plus'
  | 'homeLoan'
  | 'auto'
  | 'creditCard'
  | 'snowball'
  | 'avalanche'
  | 'check'
  | 'back'
  | 'chevronDown'
  | 'chevronRight'
  | 'chevronLeft'
  | 'search'
  | 'sort'
  | 'user'
  | 'calendar'
  | 'flag'
  | 'info'
  | 'filter'
  | 'reset'
  | 'brandRise'
  | 'trendDown';

export const NAVIGATION_TAB_ICONS: readonly {
  name: NavigationTabIconName;
  label: string;
}[] = [
  { name: 'home', label: 'Home' },
  { name: 'debt', label: 'Debt' },
  { name: 'transactions', label: 'Transactions' },
  { name: 'budget', label: 'Budget' },
  { name: 'progress', label: 'Progress' },
] as const;

export type AppIconProps = {
  name: AppIconName;
  size?: number;
  color?: string;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function AppIcon({
  name,
  size = 24,
  color = '#F9F9F6',
  selected = false,
  style,
}: AppIconProps) {
  const { isLight } = useNativeAppearance();
  return (
    <View
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
        {renderIconContent(name, appearanceColor(color, isLight), selected)}
      </Svg>
    </View>
  );
}

function renderIconContent(name: AppIconName, color: string, selected: boolean) {
  switch (name) {
    // =========================================================================
    // FIVE-TAB NAVIGATION FAMILY (Option B: Confident Solid / Sculpted Silhouette)
    // =========================================================================
    case 'home':
      return selected ? (
        <Path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M11.15 3.32a1.3 1.3 0 0 1 1.7 0l7.5 6.45c.41.35.65.87.65 1.42v7.81a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7.81c0-.55.24-1.07.65-1.42l7.5-6.45ZM10.2 14a1.8 1.8 0 1 1 3.6 0v4.8h-3.6V14Z"
          fill={color}
        />
      ) : (
        <>
          <Path
            d="M4 11l8-6.8L20 11v7.8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.8V11Z"
            stroke={color}
            strokeWidth={1.8}
            strokeLinejoin="round"
          />
          <Path d="M12 13.5v6.8" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
        </>
      );

    case 'debt':
      return selected ? (
        <>
          <Path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M4.5 4.5h11.5a2.5 2.5 0 0 1 2.5 2.5v2.2a5.5 5.5 0 0 0-6.8 7.8H4.5A2.5 2.5 0 0 1 2 14.5V7a2.5 2.5 0 0 1 2.5-2.5Zm0 3.2v1.8h11V7.7h-11Z"
            fill={color}
          />
          <Path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M16.5 21a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm2.1-5.3a.85.85 0 0 0-1.2-1.2l-1.5 1.5-.7-.7a.85.85 0 0 0-1.2 1.2l1.3 1.3c.33.33.87.33 1.2 0l2.1-2.1Z"
            fill={color}
          />
        </>
      ) : (
        <>
          <Path
            d="M18 10V6.8A1.8 1.8 0 0 0 16.2 5H4.8A1.8 1.8 0 0 0 3 6.8v7.4A1.8 1.8 0 0 0 4.8 16H11"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
          />
          <Path d="M3 9h15" stroke={color} strokeWidth={1.8} />
          <Circle cx={16.5} cy={16.2} r={3.8} stroke={color} strokeWidth={1.8} />
          <Path
            d="M15 16.2l1 1 2.2-2.2"
            stroke={color}
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );

    case 'transactions':
      return selected ? (
        <Path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M3 6.8A2.8 2.8 0 0 1 5.8 4h12.4A2.8 2.8 0 0 1 21 6.8v10.4a2.8 2.8 0 0 1-2.8 2.8H5.8A2.8 2.8 0 0 1 3 17.2V6.8Zm10.7 1.1a.9.9 0 0 1 1.27 0l2.4 2.4a.9.9 0 0 1 0 1.27l-2.4 2.4a.9.9 0 1 1-1.27-1.27l.86-.86H7.5a.9.9 0 0 1 0-1.8h7.06l-.86-.87a.9.9 0 0 1 0-1.27Zm-3.4 5.9a.9.9 0 0 1 0 1.27l-.86.86H16.5a.9.9 0 1 1 0 1.8H9.44l.86.87a.9.9 0 0 1-1.27 1.27l-2.4-2.4a.9.9 0 0 1 0-1.27l2.4-2.4a.9.9 0 0 1 1.27 0Z"
          fill={color}
        />
      ) : (
        <>
          <Rect x={3.5} y={4.5} width={17} height={15} rx={2.5} stroke={color} strokeWidth={1.8} />
          <Path
            d="M7.5 9.5h8.5m0 0-2.2-2.2m2.2 2.2-2.2 2.2"
            stroke={color}
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M16.5 14.8H8m0 0 2.2-2.2M8 14.8l2.2 2.2"
            stroke={color}
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );

    case 'budget':
      return selected ? (
        <>
          <Rect x={3.5} y={4} width={9.2} height={16} rx={2.2} fill={color} />
          <Rect x={14.5} y={4} width={6} height={7} rx={2} fill={color} />
          <Rect x={14.5} y={13} width={6} height={7} rx={2} fill={color} />
        </>
      ) : (
        <>
          <Rect x={3.5} y={4} width={9.2} height={16} rx={2} stroke={color} strokeWidth={1.8} />
          <Rect x={14.5} y={4} width={6} height={7} rx={1.8} stroke={color} strokeWidth={1.8} />
          <Rect x={14.5} y={13} width={6} height={7} rx={1.8} stroke={color} strokeWidth={1.8} />
        </>
      );

    case 'progress':
      return selected ? (
        <>
          <Rect x={4} y={14} width={3.8} height={6} rx={1.2} fill={color} />
          <Rect x={10.1} y={10.5} width={3.8} height={9.5} rx={1.2} fill={color} />
          <Rect x={16.2} y={6.5} width={3.8} height={13.5} rx={1.2} fill={color} />
          <Path
            d="M4.5 10.2 11.5 5l3.5 2 3.8-3.2"
            stroke={color}
            strokeWidth={2.1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <Rect x={4} y={14} width={3.8} height={6} rx={1} stroke={color} strokeWidth={1.75} />
          <Rect x={10.1} y={10.5} width={3.8} height={9.5} rx={1} stroke={color} strokeWidth={1.75} />
          <Rect x={16.2} y={6.5} width={3.8} height={13.5} rx={1} stroke={color} strokeWidth={1.75} />
        </>
      );

    // =========================================================================
    // COORDINATED OPTION B UTILITY & LIABILITY SET
    // =========================================================================
    case 'settings':
      return (
        <Path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M9.8 3.2h4.4l.7 2.3 2.1 1.2 2.3-.6 2.2 3.8-1.7 1.7v2.4l1.7 1.7-2.2 3.8-2.3-.6-2.1 1.2-.7 2.3H9.8l-.7-2.3-2.1-1.2-2.3.6-2.2-3.8 1.7-1.7v-2.4L2.5 9.9l2.2-3.8 2.3.6 2.1-1.2.7-2.3ZM12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
          fill={color}
        />
      );

    case 'bell':
      return (
        <>
          <Path
            d="M12 3a6 6 0 0 0-6 6v4.2l-1.6 1.8a.8.8 0 0 0 .6 1.3h14a.8.8 0 0 0 .6-1.3L18 13.2V9a6 6 0 0 0-6-6Z"
            fill={color}
          />
          <Path d="M9.8 18.2a2.4 2.4 0 0 0 4.4 0H9.8Z" fill={color} />
        </>
      );

    case 'add':
      return (
        <Path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm1-13a1 1 0 1 0-2 0v3H8a1 1 0 1 0 0 2h3v3a1 1 0 1 0 2 0v-3h3a1 1 0 1 0 0-2h-3V8Z"
          fill={color}
        />
      );

    case 'homeLoan':
      return (
        <Path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12 3.2 3.5 10.4V19a1.8 1.8 0 0 0 1.8 1.8h13.4a1.8 1.8 0 0 0 1.8-1.8v-8.6L12 3.2Zm0 5.6a2.3 2.3 0 0 0-1 4.37V17h2v-3.83A2.3 2.3 0 0 0 12 8.8Z"
          fill={color}
        />
      );

    case 'auto':
      return (
        <Path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M6.8 6a2.2 2.2 0 0 0-2 1.4L3.2 12v6.2a1.3 1.3 0 0 0 2.6 0V17h12.4v1.2a1.3 1.3 0 0 0 2.6 0V12l-1.6-4.6A2.2 2.2 0 0 0 17.2 6H6.8Zm.4 7.8a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Zm9.6 0a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z"
          fill={color}
        />
      );

    // =========================================================================
    // EXTENDED GENERIC UI & STRATEGY ACTIONS (Option B Family)
    // =========================================================================
    case 'creditCard':
      return (
        <Path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M4.5 5h15A2.5 2.5 0 0 1 22 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 16.5v-9A2.5 2.5 0 0 1 4.5 5Zm0 3.2v2h15v-2h-15Zm1.5 5.3a1 1 0 0 0 0 2h4.5a1 1 0 1 0 0-2H6Z"
          fill={color}
        />
      );

    case 'snowball':
      return (
        <>
          <Rect x={4} y={14.5} width={4.2} height={4.5} rx={1.2} fill={color} />
          <Rect x={9.9} y={10.5} width={4.2} height={8.5} rx={1.2} fill={color} />
          <Rect x={15.8} y={6} width={4.2} height={13} rx={1.2} fill={color} />
        </>
      );

    case 'avalanche':
      return (
        <Path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM9.2 10.6a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Zm6.3-1.9a.9.9 0 0 0-1.27-1.27l-6.8 6.8a.9.9 0 1 0 1.27 1.27l6.8-6.8Zm-.7 7.9a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z"
          fill={color}
        />
      );

    case 'plus':
      return (
        <Path
          d="M12 5.5v13M5.5 12h13"
          stroke={color}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      );

    case 'check':
      return (
        <Path
          d="M5.5 12.5 10 17l8.5-9.5"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );

    case 'back':
      return (
        <Path
          d="M14.8 5.5 8.5 12l6.3 6.5"
          stroke={color}
          strokeWidth={2.3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );

    case 'chevronDown':
      return (
        <Path
          d="M6.5 9.5 12 15l5.5-5.5"
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );

    case 'chevronRight':
      return (
        <Path
          d="M9.5 6.5 15 12l-5.5 5.5"
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );

    case 'chevronLeft':
      return (
        <Path
          d="M14.5 6.5 9 12l5.5 5.5"
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );

    case 'search':
      return (
        <>
          <Circle cx={11} cy={11} r={6.5} stroke={color} strokeWidth={2.2} />
          <Path d="M16 16l4.2 4.2" stroke={color} strokeWidth={2.3} strokeLinecap="round" />
        </>
      );

    case 'sort':
      return (
        <>
          <Path
            d="M8 5v14m0-14-3 3m3-3 3 3"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M16 19V5m0 14-3-3m3 3 3-3"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );

    case 'user':
      return (
        <>
          <Circle cx={12} cy={8.2} r={3.6} fill={color} />
          <Path
            d="M4.8 19.2c0-3.3 3.2-5.4 7.2-5.4s7.2 2.1 7.2 5.4a.8.8 0 0 1-.8.8H5.6a.8.8 0 0 1-.8-.8Z"
            fill={color}
          />
        </>
      );

    case 'calendar':
      return (
        <Path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M7.5 3a1 1 0 0 1 1 1v1h7V4a1 1 0 1 1 2 0v1h1A2.5 2.5 0 0 1 21 7.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-11A2.5 2.5 0 0 1 5.5 5h1V4a1 1 0 0 1 1-1Zm-2 6.5v9h13v-9h-13Z"
          fill={color}
        />
      );

    case 'flag':
      return (
        <Path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M5 3.5a1 1 0 0 1 1 1V5h11.6a1 1 0 0 1 .8 1.6L15.8 10l2.6 3.4a1 1 0 0 1-.8 1.6H6v5a1 1 0 1 1-2 0V4.5a1 1 0 0 1 1-1Z"
          fill={color}
        />
      );

    case 'info':
      return (
        <Path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-12.8a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Zm1 2.8a1 1 0 1 0-2 0v5a1 1 0 1 0 2 0v-5Z"
          fill={color}
        />
      );

    case 'filter':
      return (
        <Path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M3.5 5h17a1 1 0 0 1 .8 1.6L14.5 14v5a1 1 0 0 1-1.45.9l-3-1.5A1 1 0 0 1 9.5 17.5V14L2.7 6.6A1 1 0 0 1 3.5 5Z"
          fill={color}
        />
      );

    case 'reset':
      return (
        <>
          <Path
            d="M4.8 9.5A7.5 7.5 0 1 1 6.2 16.8"
            stroke={color}
            strokeWidth={2.1}
            strokeLinecap="round"
          />
          <Path
            d="M4.5 5v4.8h4.8"
            stroke={color}
            strokeWidth={2.1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );

    case 'brandRise':
      return (
        <Path
          d="M7 17 17 7M9.5 7H17v7.5"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );

    case 'trendDown':
      return (
        <Path
          d="M6.5 6.5 17.5 17.5M17.5 10v7.5H10"
          stroke={color}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
  }
}
