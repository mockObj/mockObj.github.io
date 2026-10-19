// The standalone HTML export uses the same source files as the Astro viewer.
// ?raw is evaluated by Vite during the build; no source-file HTTP endpoint is needed.
import template from '../templates/viewer.html?raw';
import css from '../styles/viewer.css?raw';
import settings from '../scripts/viewer-settings.js?raw';
import { viewerAnimationCSS } from './viewer-styles.js';
import graphics from '../scripts/eyes.js?raw';
import layout from '../scripts/field-layout.js?raw';
import renderer from '../scripts/field-gl.js?raw';
import model from './collection-model.js?raw';
import format from './collection-format.js?raw';
import shared from './collection-store.js?raw';
import viewer from '../scripts/viewer.js?raw';
import random from '../scripts/random-field.js?raw';
import loading from '../scripts/loading-screen.js?raw';

export const exportSources = {
  'index.html': template,
  'viewer.css': viewerAnimationCSS + '\n' + css,
  'viewer-settings.js': settings,
  'assets/eyes.js': graphics,
  'field-layout.js': layout,
  'field-gl.js': renderer,
  'model.js': model,
  'format.js': format,
  'shared.js': shared,
  'viewer.js': viewer,
  'random-field.js': random,
  'loading.js': loading,
};

export const serializeForScript = (value: unknown) => JSON.stringify(value)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
