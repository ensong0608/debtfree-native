import Svg, { Path, Rect, Circle } from 'react-native-svg';
import type { NavigationTabIconName } from './AppIcon';

export function NavigationIcon({ name, color }: { name: NavigationTabIconName; color: string }) {
  return <Svg accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.85} strokeLinecap="round" strokeLinejoin="round">
    {name === 'home' ? <><Path d="M2.8 11.1 12 3.4l9.2 7.7M4.8 9.5V20h14.4V9.5M12 11.3v6.2" /><Path d="M14.2 12.4c-.35-.7-1.1-1.05-2.1-1.05-1.15 0-1.9.55-1.9 1.35 0 1.8 4 1 4 3.1 0 .8-.78 1.4-2.05 1.4-1.02 0-1.82-.4-2.2-1.15" /></> : null}
    {name === 'debt' ? <><Rect x="3.5" y="5.5" width="17" height="13" rx="2.2" /><Path d="M4 9.8h16M7 14.2h4" /></> : null}
    {name === 'transactions' ? <><Rect x="4" y="5.5" width="16" height="14.5" rx="1.8" /><Path d="M8 3.5v4M16 3.5v4M4 9.5h16" />{[8, 12, 16].map(x => [13, 16.5].map(y => <Circle key={`${x}-${y}`} cx={x} cy={y} r=".55" fill={color} stroke="none" />))}</> : null}
    {name === 'budget' ? <><Path d="M5.4 5h12.2a2 2 0 0 1 2 2v1.3M5.5 5a2.5 2.5 0 0 0 0 5h14.8v9.2H5.5A2.5 2.5 0 0 1 3 16.7V7.5A2.5 2.5 0 0 1 5.5 5ZM17.3 12.5h4v4h-4a2 2 0 0 1 0-4Z" /><Circle cx="17.7" cy="14.5" r=".45" fill={color} stroke="none" /></> : null}
    {name === 'progress' ? <><Rect x="3.5" y="3.8" width="17" height="11.5" rx="1.5" /><Path d="m7.5 11.2 3.1-3.1 2.2 1.9 3.8-4.1M14.2 5.9h2.5v2.5M8 15.3l4 5.2 4-5.2M12 20.5H8m4 0h4" /></> : null}
  </Svg>;
}
