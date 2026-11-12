import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkChunkGraph } from '../../scripts/check-chunk-graph.mjs';

type Graph = Parameters<typeof checkChunkGraph>[0];
type Contracts = Parameters<typeof checkChunkGraph>[1];

const contracts = JSON.parse(readFileSync('scripts/chunks.json', 'utf8')) as Contracts & {
  chunks: NonNullable<Contracts['chunks']>;
};

/** A graph that honours every contract: each entry in its own chunk, singletons in main. */
function goodGraph(): Graph {
  const chunks: Graph['chunks'] = {
    'static/js/main.AAAAAAAA.js': {
      name: 'index',
      isEntry: true,
      modules: ['src/index.tsx', 'node_modules/react/index.js', ...(contracts.singletons ?? []).map((s) => s.module)],
    },
  };
  for (const c of contracts.chunks) {
    chunks[`static/js/${c.name}.BBBBBBBB.chunk.js`] = { name: c.name, isEntry: false, modules: [c.entry.endsWith('/') ? `${c.entry}x.js` : c.entry] };
  }
  const modules: Graph['modules'] = {};
  for (const [file, chunk] of Object.entries(chunks)) for (const id of chunk.modules) (modules[id] ??= []).push(file);
  return { chunks, modules };
}

function withMainModule(graph: Graph, id: string): Graph {
  const mainFile = 'static/js/main.AAAAAAAA.js';
  graph.chunks[mainFile]!.modules.push(id);
  (graph.modules[id] ??= []).push(mainFile);
  return graph;
}

describe('chunk contracts (scripts/chunks.json)', () => {
  it('a graph with every contract honoured passes', () => {
    expect(checkChunkGraph(goodGraph(), contracts)).toEqual([]);
  });

  it('fails when onnxruntime-web lands in the main chunk', () => {
    const errors = checkChunkGraph(withMainModule(goodGraph(), 'node_modules/onnxruntime-web/dist/ort.mjs'), contracts);
    expect(errors.join('\n')).toMatch(/main chunk contains forbidden module node_modules\/onnxruntime-web/);
  });

  it('fails when cesium lands in the main chunk', () => {
    const errors = checkChunkGraph(withMainModule(goodGraph(), 'node_modules/cesium/Source/Cesium.js'), contracts);
    expect(errors.join('\n')).toMatch(/main chunk contains forbidden module node_modules\/cesium/);
  });

  it('fails when a lazy chunk entry is also in the main chunk', () => {
    const errors = checkChunkGraph(withMainModule(goodGraph(), 'src/car/carModeRuntime.ts'), contracts);
    expect(errors.join('\n')).toMatch(/entry of lazy chunk "carModeRuntime"/);
  });

  it('fails when a singleton is duplicated into a second chunk', () => {
    const graph = goodGraph();
    const id = 'src/renderer/cabinOverlayRegistry.ts';
    const lazy = 'static/js/carModeRuntime.BBBBBBBB.chunk.js';
    graph.chunks[lazy]!.modules.push(id);
    graph.modules[id]!.push(lazy);
    expect(checkChunkGraph(graph, contracts).join('\n')).toMatch(/singleton src\/renderer\/cabinOverlayRegistry\.ts was duplicated/);
  });

  it('fails when a contract chunk disappears', () => {
    const graph = goodGraph();
    delete graph.chunks['static/js/GlobeView.BBBBBBBB.chunk.js'];
    expect(checkChunkGraph(graph, contracts).join('\n')).toMatch(/chunk "GlobeView" was not emitted/);
  });

  it('keeps three/webgpu out of the car runtime chunk', () => {
    const graph = goodGraph();
    graph.chunks['static/js/carModeRuntime.BBBBBBBB.chunk.js']!.modules.push('node_modules/three/build/three.webgpu.js');
    expect(checkChunkGraph(graph, contracts).join('\n')).toMatch(/chunk "carModeRuntime" contains forbidden module/);
  });
});
