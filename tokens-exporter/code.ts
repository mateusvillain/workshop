type ExportableType = 'variable-collection' | 'paint-styles' | 'text-styles' | 'effect-styles' | 'grid-styles';

type ExportableSummary = {
  id: string;
  type: ExportableType;
  name: string;
  count: number;
  description: string;
};

type FileExport = {
  id: string;
  name: string;
  content: string;
  warnings: string[];
  sourceId: string;
};

type SelectionMessage = {
  type: 'generate-exports';
  selectedIds: string[];
};

type CancelMessage = {
  type: 'cancel';
};

type IncomingMessage = SelectionMessage | CancelMessage;

type VariablePathRegistry = {
  [variableId: string]: string[];
};

type DtcgToken = {
  $value: unknown;
  $type?: string;
};

type DtcgFile = {
  [key: string]: unknown;
};

type VariableTypeInference = {
  type?: string;
  unit?: 'px' | 'ms';
};

figma.showUI(__html__, {
  width: 1120,
  height: 760,
  themeColors: true,
});

void bootstrap();

async function bootstrap(): Promise<void> {
  const exportables = await loadExportables();

  figma.ui.postMessage({
    type: 'init',
    exportables,
  });
}

figma.ui.onmessage = async (msg: IncomingMessage) => {
  if (msg.type === 'cancel') {
    figma.closePlugin();
    return;
  }

  if (msg.type !== 'generate-exports') {
    return;
  }

  try {
    const files = await buildExports(msg.selectedIds);
    figma.ui.postMessage({
      type: 'exports-generated',
      files,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    figma.ui.postMessage({
      type: 'exports-error',
      message,
    });
  }
};

async function loadExportables(): Promise<ExportableSummary[]> {
  const summaries: ExportableSummary[] = [];

  const variableCollections = await figma.variables.getLocalVariableCollectionsAsync();
  for (let i = 0; i < variableCollections.length; i += 1) {
    const collection = variableCollections[i];
    summaries.push({
      id: collection.id,
      type: 'variable-collection',
      name: collection.name,
      count: collection.variableIds.length,
      description:
        collection.modes.length > 1
          ? collection.modes.length + ' modes'
          : '1 mode',
    });
  }

  const paintStyles = await figma.getLocalPaintStylesAsync();
  if (paintStyles.length > 0) {
    summaries.push({
      id: 'styles:paint',
      type: 'paint-styles',
      name: 'Paint styles',
      count: paintStyles.length,
      description: 'Color and gradient styles',
    });
  }

  const textStyles = await figma.getLocalTextStylesAsync();
  if (textStyles.length > 0) {
    summaries.push({
      id: 'styles:text',
      type: 'text-styles',
      name: 'Text styles',
      count: textStyles.length,
      description: 'Typography composite tokens',
    });
  }

  const effectStyles = await figma.getLocalEffectStylesAsync();
  if (effectStyles.length > 0) {
    summaries.push({
      id: 'styles:effect',
      type: 'effect-styles',
      name: 'Effect styles',
      count: effectStyles.length,
      description: 'Shadows and raw effect fallbacks',
    });
  }

  const gridStyles = await figma.getLocalGridStylesAsync();
  if (gridStyles.length > 0) {
    summaries.push({
      id: 'styles:grid',
      type: 'grid-styles',
      name: 'Grid styles',
      count: gridStyles.length,
      description: 'Raw layout grid data',
    });
  }

  return summaries;
}

async function buildExports(selectedIds: string[]): Promise<FileExport[]> {
  const files: FileExport[] = [];
  const selectedLookup = toLookup(selectedIds);

  const variableCollections = await figma.variables.getLocalVariableCollectionsAsync();
  const globalVariablePathRegistry = await buildGlobalVariablePathRegistry(variableCollections);
  for (let i = 0; i < variableCollections.length; i += 1) {
    const collection = variableCollections[i];
    if (!selectedLookup[collection.id]) {
      continue;
    }

    const collectionFiles = await exportVariableCollection(collection, globalVariablePathRegistry);
    for (let j = 0; j < collectionFiles.length; j += 1) {
      files.push(collectionFiles[j]);
    }
  }

  if (selectedLookup['styles:paint']) {
    const styleFiles = await exportPaintStyles();
    for (let i = 0; i < styleFiles.length; i += 1) {
      files.push(styleFiles[i]);
    }
  }

  if (selectedLookup['styles:text']) {
    const styleFiles = await exportTextStyles();
    for (let i = 0; i < styleFiles.length; i += 1) {
      files.push(styleFiles[i]);
    }
  }

  if (selectedLookup['styles:effect']) {
    const styleFiles = await exportEffectStyles();
    for (let i = 0; i < styleFiles.length; i += 1) {
      files.push(styleFiles[i]);
    }
  }

  if (selectedLookup['styles:grid']) {
    const styleFiles = await exportGridStyles();
    for (let i = 0; i < styleFiles.length; i += 1) {
      files.push(styleFiles[i]);
    }
  }

  return files;
}

async function exportVariableCollection(
  collection: VariableCollection,
  globalVariablePathRegistry: VariablePathRegistry,
): Promise<FileExport[]> {
  const variables = await loadVariables(collection.variableIds);
  const files: FileExport[] = [];

  for (let modeIndex = 0; modeIndex < collection.modes.length; modeIndex += 1) {
    const mode = collection.modes[modeIndex];
    const warnings: string[] = [];
    const document: DtcgFile = {};

    const consumer = figma.createFrame();
    try {
      await setExplicitModesForAllCollections(consumer, collection.id, mode.modeId);

      for (let variableIndex = 0; variableIndex < variables.length; variableIndex += 1) {
        const variable = variables[variableIndex];
        const tokenPath = globalVariablePathRegistry[variable.id];
        const token = serializeVariableToken(variable, {
          modeId: mode.modeId,
          consumer,
          variablePaths: globalVariablePathRegistry,
          warnings,
        });
        insertToken(document, tokenPath, token);
      }
    } finally {
      consumer.remove();
    }

    hoistGroupTypes(document);

    const fileNameBase =
      collection.modes.length > 1
        ? sanitizeFileName(collection.name) + '.' + sanitizeFileName(mode.name)
        : sanitizeFileName(collection.name);

    files.push({
      id: collection.id + ':' + mode.modeId,
      name: fileNameBase + '.json',
      content: JSON.stringify(document, null, 2),
      warnings,
      sourceId: collection.id,
    });
  }

  return files;
}

async function exportPaintStyles(): Promise<FileExport[]> {
  const styles = await figma.getLocalPaintStylesAsync();
  const warnings: string[] = [];
  const document: DtcgFile = {};

  for (let i = 0; i < styles.length; i += 1) {
    const style = styles[i];
    insertToken(document, buildNamePath(style.name), serializePaintStyle(style, warnings));
  }

  hoistGroupTypes(document);

  return [
    {
      id: 'styles:paint',
      name: 'paint-styles.json',
      content: JSON.stringify(document, null, 2),
      warnings,
      sourceId: 'styles:paint',
    },
  ];
}

async function exportTextStyles(): Promise<FileExport[]> {
  const styles = await figma.getLocalTextStylesAsync();
  const warnings: string[] = [];
  const document: DtcgFile = {};

  for (let i = 0; i < styles.length; i += 1) {
    const style = styles[i];
    insertToken(document, buildNamePath(style.name), serializeTextStyle(style, warnings));
  }

  hoistGroupTypes(document);

  return [
    {
      id: 'styles:text',
      name: 'text-styles.json',
      content: JSON.stringify(document, null, 2),
      warnings,
      sourceId: 'styles:text',
    },
  ];
}

async function exportEffectStyles(): Promise<FileExport[]> {
  const styles = await figma.getLocalEffectStylesAsync();
  const warnings: string[] = [];
  const document: DtcgFile = {};

  for (let i = 0; i < styles.length; i += 1) {
    const style = styles[i];
    insertToken(document, buildNamePath(style.name), serializeEffectStyle(style, warnings));
  }

  hoistGroupTypes(document);

  return [
    {
      id: 'styles:effect',
      name: 'effect-styles.json',
      content: JSON.stringify(document, null, 2),
      warnings,
      sourceId: 'styles:effect',
    },
  ];
}

async function exportGridStyles(): Promise<FileExport[]> {
  const styles = await figma.getLocalGridStylesAsync();
  const warnings: string[] = [];
  const document: DtcgFile = {};

  for (let i = 0; i < styles.length; i += 1) {
    const style = styles[i];
    insertToken(document, buildNamePath(style.name), serializeGridStyle(style, warnings));
  }

  hoistGroupTypes(document);

  return [
    {
      id: 'styles:grid',
      name: 'grid-styles.json',
      content: JSON.stringify(document, null, 2),
      warnings,
      sourceId: 'styles:grid',
    },
  ];
}

async function loadVariables(variableIds: string[]): Promise<Variable[]> {
  const variables: Variable[] = [];

  for (let i = 0; i < variableIds.length; i += 1) {
    const variable = await figma.variables.getVariableByIdAsync(variableIds[i]);
    if (variable) {
      variables.push(variable);
    }
  }

  return variables;
}

async function setExplicitModesForAllCollections(
  consumer: FrameNode,
  targetCollectionId: string,
  targetModeId: string,
): Promise<void> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  for (let i = 0; i < collections.length; i += 1) {
    const collection = collections[i];
    const modeId = collection.id === targetCollectionId ? targetModeId : collection.defaultModeId;
    consumer.setExplicitVariableModeForCollection(collection, modeId);
  }
}

function buildVariablePathRegistry(variables: Variable[]): VariablePathRegistry {
  const registry: VariablePathRegistry = {};
  const occupiedPaths: {
    [path: string]: true;
  } = {};

  for (let i = 0; i < variables.length; i += 1) {
    const variable = variables[i];
    const path = buildNamePath(variable.name);
    const uniquePath = makeUniquePath(path, occupiedPaths, shortHash(variable.id));
    occupiedPaths[uniquePath.join('/')] = true;
    registry[variable.id] = uniquePath;
  }

  return registry;
}

async function buildGlobalVariablePathRegistry(
  collections: VariableCollection[],
): Promise<VariablePathRegistry> {
  const variableIds: string[] = [];

  for (let i = 0; i < collections.length; i += 1) {
    const collection = collections[i];
    for (let j = 0; j < collection.variableIds.length; j += 1) {
      variableIds.push(collection.variableIds[j]);
    }
  }

  const variables = await loadVariables(variableIds);
  return buildVariablePathRegistry(variables);
}

function serializeVariableToken(
  variable: Variable,
  options: {
    modeId: string;
    consumer: SceneNode;
    variablePaths: VariablePathRegistry;
    warnings: string[];
  },
): DtcgToken {
  const inferred = inferVariableType(variable);
  const rawValue = variable.valuesByMode[options.modeId];

  const token: DtcgToken = {
    $value: serializeVariableValue(variable, rawValue, inferred, options),
  };

  if (inferred.type) {
    token.$type = inferred.type;
  }

  return token;
}

function serializeVariableValue(
  variable: Variable,
  rawValue: VariableValue,
  inferred: VariableTypeInference,
  options: {
    consumer: SceneNode;
    variablePaths: VariablePathRegistry;
    warnings: string[];
  },
): unknown {
  if (isVariableAlias(rawValue)) {
    const aliasPath = options.variablePaths[rawValue.id];
    if (aliasPath) {
      return '{' + aliasPath.join('.') + '}';
    }

    const resolvedValue = variable.resolveForConsumer(options.consumer).value;
    options.warnings.push(
      'Resolved cross-collection alias "' +
        variable.name +
        '" to a concrete value because each collection is exported as an independent file.',
    );
    return serializeResolvedValue(resolvedValue, inferred);
  }

  return serializeResolvedValue(rawValue, inferred);
}

function serializeResolvedValue(value: VariableValue, inferred: VariableTypeInference): unknown {
  if (typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') {
    if (typeof value === 'number' && inferred.type === 'dimension' && inferred.unit) {
      return dimension(value, inferred.unit);
    }

    return value;
  }

  if (isColorValue(value)) {
    return toDtcgColor(value);
  }

  return value;
}

function serializePaintStyle(style: PaintStyle, warnings: string[]): DtcgToken {
  if (style.paints.length === 1) {
    const paint = style.paints[0];

    if (paint.type === 'SOLID') {
      return {
        $type: 'color',
        $value: toDtcgColor(paint),
      };
    }

    if (isGradientPaint(paint)) {
      return {
        $type: 'gradient',
        $value: gradientStopsToDtcg(paint.gradientStops),
      };
    }
  }

  warnings.push(
    'Paint style "' +
      style.name +
      '" uses multiple or unsupported paints and was exported as raw paint data.',
  );

  return {
    $value: normalizePaintArray(style.paints),
  };
}

function serializeTextStyle(style: TextStyle, warnings: string[]): DtcgToken {
  const fontWeight = inferFontWeight(style.fontName.style);
  const lineHeight = normalizeLineHeight(style.lineHeight, style.fontSize, warnings, style.name);
  const letterSpacing = normalizeLetterSpacing(style.letterSpacing, style.fontSize);
  return {
    $type: 'typography',
    $value: {
      fontFamily: style.fontName.family,
      fontSize: dimension(style.fontSize, 'px'),
      fontWeight,
      letterSpacing,
      lineHeight,
    },
  };
}

function serializeEffectStyle(style: EffectStyle, warnings: string[]): DtcgToken {
  let allShadows = true;
  for (let i = 0; i < style.effects.length; i += 1) {
    const effect = style.effects[i];
    if (effect.type !== 'DROP_SHADOW' && effect.type !== 'INNER_SHADOW') {
      allShadows = false;
      break;
    }
  }

  if (allShadows && style.effects.length > 0) {
    const shadows = [];
    for (let i = 0; i < style.effects.length; i += 1) {
      const effect = style.effects[i];
      if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
        shadows.push(effectToShadowToken(effect));
      }
    }

    return {
      $type: 'shadow',
      $value: shadows.length === 1 ? shadows[0] : shadows,
    };
  }

  warnings.push(
    'Effect style "' +
      style.name +
      '" contains non-shadow effects and was exported as raw effect data.',
  );

  return {
    $value: normalizeEffectArray(style.effects),
  };
}

function serializeGridStyle(style: GridStyle, warnings: string[]): DtcgToken {
  warnings.push(
    'Grid style "' +
      style.name +
      '" has no direct DTCG 2025.10 type and was exported as raw layout grid data.',
  );

  return {
    $value: normalizeLayoutGridArray(style.layoutGrids),
  };
}

function insertToken(target: { [key: string]: unknown }, path: string[], token: DtcgToken): void {
  let current: { [key: string]: unknown } = target;

  for (let i = 0; i < path.length; i += 1) {
    const segment = path[i];
    const isLast = i === path.length - 1;
    const existing = current[segment];

    if (isLast) {
      if (existing === undefined) {
        current[segment] = token;
        return;
      }

      if (isToken(existing)) {
        current[segment + '-' + shortHash(JSON.stringify(token))] = token;
        return;
      }

      const group = existing as { [key: string]: unknown };
      if (group.$root === undefined) {
        group.$root = token;
        return;
      }

      group['token-' + shortHash(JSON.stringify(token))] = token;
      return;
    }

    if (existing === undefined) {
      current[segment] = {};
      current = current[segment] as { [key: string]: unknown };
      continue;
    }

    if (isToken(existing)) {
      current[segment] = {
        $root: existing,
      };
    }

    current = current[segment] as { [key: string]: unknown };
  }
}

function buildNamePath(name: string): string[] {
  const segments = name.split('/');
  const path: string[] = [];

  for (let i = 0; i < segments.length; i += 1) {
    const segment = sanitizeTokenName(segments[i]);
    path.push(segment || 'token');
  }

  return path;
}

function hoistGroupTypes(node: { [key: string]: unknown }): string | null {
  const childKeys = getChildKeys(node);
  if (childKeys.length === 0) {
    return typeof node.$type === 'string' ? node.$type : null;
  }

  let sharedType: string | null = null;

  for (let i = 0; i < childKeys.length; i += 1) {
    const child = node[childKeys[i]];
    if (!isObjectRecord(child)) {
      return typeof node.$type === 'string' ? node.$type : null;
    }

    const childType = isToken(child) ? child.$type || null : hoistGroupTypes(child);
    if (!childType) {
      sharedType = null;
      break;
    }

    if (sharedType === null) {
      sharedType = childType;
      continue;
    }

    if (sharedType !== childType) {
      sharedType = null;
      break;
    }
  }

  if (!sharedType) {
    return typeof node.$type === 'string' ? node.$type : null;
  }

  node.$type = sharedType;
  for (let i = 0; i < childKeys.length; i += 1) {
    const child = node[childKeys[i]];
    if (isObjectRecord(child) && child.$type === sharedType) {
      delete child.$type;
    }
  }

  return sharedType;
}

function getChildKeys(node: { [key: string]: unknown }): string[] {
  const keys: string[] = [];

  for (const key in node) {
    if (key.charAt(0) !== '$') {
      keys.push(key);
    }
  }

  return keys;
}

function sanitizeTokenName(name: string): string {
  const trimmed = name.trim();
  let sanitized = '';

  for (let i = 0; i < trimmed.length; i += 1) {
    const character = trimmed[i];
    if (character === '{' || character === '}' || character === '.') {
      sanitized += '-';
      continue;
    }

    sanitized += character;
  }

  sanitized = sanitized.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[-$]+/, '').replace(/-+$/, '');
  return sanitized;
}

function sanitizeFileName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tokens';
}

function makeUniquePath(
  path: string[],
  occupiedPaths: { [path: string]: true },
  suffix: string,
): string[] {
  const base = path.slice();
  let candidate = base.slice();
  let index = 1;

  while (occupiedPaths[candidate.join('/')]) {
    candidate = base.slice();
    candidate[candidate.length - 1] = base[base.length - 1] + '-' + suffix + (index > 1 ? '-' + index : '');
    index += 1;
  }

  return candidate;
}

function inferVariableType(variable: Variable): VariableTypeInference {
  if (variable.resolvedType === 'COLOR') {
    return { type: 'color' };
  }

  if (variable.resolvedType === 'BOOLEAN') {
    return {};
  }

  if (variable.resolvedType === 'STRING') {
    if (hasScope(variable.scopes, 'FONT_FAMILY')) {
      return { type: 'fontFamily' };
    }

    return {};
  }

  if (hasScope(variable.scopes, 'FONT_WEIGHT')) {
    return { type: 'fontWeight' };
  }

  if (hasScope(variable.scopes, 'OPACITY') || hasScope(variable.scopes, 'LINE_HEIGHT')) {
    return { type: 'number' };
  }

  if (
    hasScope(variable.scopes, 'CORNER_RADIUS') ||
    hasScope(variable.scopes, 'WIDTH_HEIGHT') ||
    hasScope(variable.scopes, 'GAP') ||
    hasScope(variable.scopes, 'STROKE_FLOAT') ||
    hasScope(variable.scopes, 'EFFECT_FLOAT') ||
    hasScope(variable.scopes, 'FONT_SIZE')
  ) {
    return {
      type: 'dimension',
      unit: 'px',
    };
  }

  return {
    type: 'number',
  };
}

function hasScope(scopes: VariableScope[], scope: VariableScope): boolean {
  for (let i = 0; i < scopes.length; i += 1) {
    if (scopes[i] === scope || scopes[i] === 'ALL_SCOPES') {
      return true;
    }
  }

  return false;
}

function inferFontWeight(styleName: string): number | string {
  const normalized = styleName.trim().toLowerCase();

  if (normalized.indexOf('thin') >= 0 || normalized.indexOf('hairline') >= 0) {
    return 100;
  }
  if (normalized.indexOf('extra light') >= 0 || normalized.indexOf('ultra light') >= 0) {
    return 200;
  }
  if (normalized.indexOf('light') >= 0) {
    return 300;
  }
  if (normalized.indexOf('medium') >= 0) {
    return 500;
  }
  if (normalized.indexOf('semi bold') >= 0 || normalized.indexOf('demi bold') >= 0) {
    return 600;
  }
  if (normalized.indexOf('extra bold') >= 0 || normalized.indexOf('ultra bold') >= 0) {
    return 800;
  }
  if (normalized.indexOf('black') >= 0 || normalized.indexOf('heavy') >= 0) {
    return 900;
  }
  if (normalized.indexOf('bold') >= 0) {
    return 700;
  }

  return 400;
}

function normalizeLetterSpacing(letterSpacing: LetterSpacing, fontSize: number): { value: number; unit: 'px' } {
  if (letterSpacing.unit === 'PERCENT') {
    return dimension((fontSize * letterSpacing.value) / 100, 'px');
  }

  return dimension(letterSpacing.value, 'px');
}

function normalizeLineHeight(
  lineHeight: LineHeight,
  fontSize: number,
  warnings: string[],
  styleName: string,
): number {
  if (lineHeight.unit === 'AUTO') {
    warnings.push(
      'Text style "' +
        styleName +
        '" uses AUTO line-height; exported as 1 because DTCG typography expects a numeric multiplier.',
    );
    return 1;
  }

  if (lineHeight.unit === 'PERCENT') {
    return round(lineHeight.value / 100);
  }

  if (fontSize === 0) {
    return 1;
  }

  return round(lineHeight.value / fontSize);
}

function gradientStopsToDtcg(stops: ReadonlyArray<ColorStop>): Array<{ color: unknown; position: number }> {
  const result: Array<{ color: unknown; position: number }> = [];

  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i];
    result.push({
      color: toDtcgColor(stop.color),
      position: round(stop.position),
    });
  }

  return result;
}

function effectToShadowToken(effect: DropShadowEffect | InnerShadowEffect): {
  color: unknown;
  offsetX: { value: number; unit: 'px' };
  offsetY: { value: number; unit: 'px' };
  blur: { value: number; unit: 'px' };
  spread: { value: number; unit: 'px' };
  inset?: boolean;
} {
  const token = {
    color: toDtcgColor(effect.color),
    offsetX: dimension(effect.offset.x, 'px'),
    offsetY: dimension(effect.offset.y, 'px'),
    blur: dimension(effect.radius, 'px'),
    spread: dimension(effect.spread || 0, 'px'),
  };

  if (effect.type === 'INNER_SHADOW') {
    return {
      color: token.color,
      offsetX: token.offsetX,
      offsetY: token.offsetY,
      blur: token.blur,
      spread: token.spread,
      inset: true,
    };
  }

  return token;
}

function toDtcgColor(color: RGB | RGBA | SolidPaint): {
  colorSpace: 'srgb';
  components: number[];
  alpha: number;
  hex: string;
} {
  const rgb = 'color' in color ? color.color : color;
  const alpha = 'opacity' in color ? color.opacity : 'a' in color ? color.a : undefined;
  const result: {
    colorSpace: 'srgb';
    components: number[];
    alpha: number;
    hex: string;
  } = {
    colorSpace: 'srgb',
    components: [normalizeColorComponent(rgb.r), normalizeColorComponent(rgb.g), normalizeColorComponent(rgb.b)],
    alpha: alpha === undefined ? 1 : normalizeAlpha(alpha),
    hex: rgbToHex(rgb),
  };

  return result;
}

function dimension<TUnit extends 'px' | 'ms'>(
  value: number,
  unit: TUnit,
): { value: number; unit: TUnit } {
  return {
    value: round(value),
    unit,
  };
}

function rgbToHex(color: RGB | RGBA): string {
  return (
    '#' +
    toHex(color.r) +
    toHex(color.g) +
    toHex(color.b)
  );
}

function toHex(channel: number): string {
  const value = Math.max(0, Math.min(255, Math.round(channel * 255)));
  const hex = value.toString(16);
  return hex.length === 1 ? '0' + hex : hex;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function normalizeColorComponent(value: number): number {
  return Math.round(value * 255) / 255;
}

function normalizeAlpha(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function normalizePaintArray(paints: ReadonlyArray<Paint>): unknown[] {
  const result: unknown[] = [];
  for (let i = 0; i < paints.length; i += 1) {
    result.push(normalizePaint(paints[i]));
  }
  return result;
}

function normalizePaint(paint: Paint): unknown {
  if (paint.type === 'SOLID') {
    return {
      type: paint.type,
      color: toDtcgColor(paint),
      visible: paint.visible !== false,
      opacity: paint.opacity === undefined ? 1 : round(paint.opacity),
      blendMode: paint.blendMode || 'NORMAL',
    };
  }

  if (isGradientPaint(paint)) {
    return {
      type: paint.type,
      visible: paint.visible !== false,
      opacity: paint.opacity === undefined ? 1 : round(paint.opacity),
      blendMode: paint.blendMode || 'NORMAL',
      gradientStops: gradientStopsToDtcg(paint.gradientStops),
      gradientTransform: paint.gradientTransform,
    };
  }

  if (paint.type === 'IMAGE') {
    return {
      type: paint.type,
      scaleMode: paint.scaleMode,
      imageHash: paint.imageHash,
      opacity: paint.opacity === undefined ? 1 : round(paint.opacity),
      visible: paint.visible !== false,
    };
  }

  if (paint.type === 'VIDEO') {
    return {
      type: paint.type,
      scaleMode: paint.scaleMode,
      videoHash: paint.videoHash,
      opacity: paint.opacity === undefined ? 1 : round(paint.opacity),
      visible: paint.visible !== false,
    };
  }

  return {
    type: paint.type,
  };
}

function normalizeEffectArray(effects: ReadonlyArray<Effect>): unknown[] {
  const result: unknown[] = [];
  for (let i = 0; i < effects.length; i += 1) {
    const effect = effects[i];
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      result.push(effectToShadowToken(effect));
      continue;
    }

    if (effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR') {
      result.push({
        type: effect.type,
        radius: dimension(effect.radius, 'px'),
        visible: effect.visible,
        blurType: effect.blurType,
      });
      continue;
    }

    result.push(effect);
  }
  return result;
}

function normalizeLayoutGridArray(layoutGrids: ReadonlyArray<LayoutGrid>): unknown[] {
  const result: unknown[] = [];
  for (let i = 0; i < layoutGrids.length; i += 1) {
    const grid = layoutGrids[i];
    result.push(grid);
  }
  return result;
}

function isGradientPaint(paint: Paint): paint is GradientPaint {
  return (
    paint.type === 'GRADIENT_LINEAR' ||
    paint.type === 'GRADIENT_RADIAL' ||
    paint.type === 'GRADIENT_ANGULAR' ||
    paint.type === 'GRADIENT_DIAMOND'
  );
}

function isVariableAlias(value: VariableValue): value is VariableAlias {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS';
}

function isColorValue(value: VariableValue): value is RGB | RGBA {
  return typeof value === 'object' && value !== null && 'r' in value && 'g' in value && 'b' in value;
}

function isToken(value: unknown): value is DtcgToken {
  return typeof value === 'object' && value !== null && '$value' in value;
}

function isObjectRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null;
}

function shortHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).slice(0, 6);
}

function toLookup(values: string[]): { [value: string]: true } {
  const lookup: { [value: string]: true } = {};
  for (let i = 0; i < values.length; i += 1) {
    lookup[values[i]] = true;
  }
  return lookup;
}
