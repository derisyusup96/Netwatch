import { registerRootComponent } from 'expo';
import App from './App';

if (typeof document !== 'undefined') {
  document.documentElement.style.cssText = 'width:100%;height:100vh;height:100dvh;overflow:hidden;background:#030a19;';
  document.body.style.cssText = 'width:100%;height:100vh;height:100dvh;margin:0;overflow:hidden;background:#030a19;';
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  const style = document.createElement('style');
  style.textContent = '#root{width:100%;height:100vh;height:100dvh;min-height:0;overflow:hidden;}#root>div{height:100%;min-height:0;}';
  document.head.appendChild(style);
}

registerRootComponent(App);
