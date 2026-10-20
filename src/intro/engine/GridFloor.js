/**
 * MARKET POLARIS — Grid Floor
 * Subtle infinite grid that anchors the 3D space
 * Pulses with energy during convergence
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class GridFloor {
  constructor() {
    this.group = new THREE.Group();
    this.build();
  }

  build() {
    // Custom grid shader — much more elegant than Three's GridHelper
    const gridSize = 60;
    const geometry = new THREE.PlaneGeometry(gridSize, gridSize, 1, 1);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uPulseIntensity: { value: 0 },
        uColor: { value: new THREE.Color(CONFIG.colors.gridDim) },
        uActiveColor: { value: new THREE.Color(CONFIG.colors.blue) },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        
        void main() {
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uOpacity;
        uniform float uPulseIntensity;
        uniform vec3 uColor;
        uniform vec3 uActiveColor;
        
        varying vec2 vUv;
        varying vec3 vWorldPos;
        
        float grid(vec2 p, float size) {
          vec2 grid = abs(fract(p / size - 0.5) - 0.5) / fwidth(p / size);
          return 1.0 - min(min(grid.x, grid.y), 1.0);
        }
        
        void main() {
          vec2 worldXZ = vWorldPos.xz;
          
          // Multi-scale grid
          float gridLarge = grid(worldXZ, 4.0) * 0.5;
          float gridSmall = grid(worldXZ, 1.0) * 0.2;
          float gridVal = max(gridLarge, gridSmall);
          
          // Radial fade
          float dist = length(worldXZ);
          float radialFade = 1.0 - smoothstep(8.0, 30.0, dist);
          
          // Pulse wave from center
          float pulseWave = sin(dist * 0.8 - uTime * 2.0) * 0.5 + 0.5;
          float pulseGlow = pulseWave * uPulseIntensity * exp(-dist * 0.08);
          
          // Color
          vec3 col = mix(uColor, uActiveColor, pulseGlow * 0.5);
          
          float alpha = gridVal * radialFade * uOpacity + pulseGlow * 0.15 * radialFade;
          
          if (alpha < 0.005) discard;
          
          gl_FragColor = vec4(col, alpha);
        }
      `
    });

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -4;

    this.group.add(mesh);

    // Ambient floating horizontal lines (market data streams)
    this.buildDataStreams();
  }

  buildDataStreams() {
    const streamCount = 12;

    for (let i = 0; i < streamCount; i++) {
      const y = (i - streamCount / 2) * 2.0 + (Math.random() - 0.5) * 1.5;
      const z = (Math.random() - 0.5) * 15;
      const width = 15 + Math.random() * 25;

      const points = [];
      const segments = 50;

      for (let j = 0; j <= segments; j++) {
        const t = j / segments;
        const x = (t - 0.5) * width;
        const yOffset = Math.sin(t * Math.PI * (2 + Math.random())) * 0.3;
        points.push(new THREE.Vector3(x, y + yOffset, z));
      }

      const lineGeom = new THREE.BufferGeometry().setFromPoints(points);

      const lineMat = new THREE.LineBasicMaterial({
        color: CONFIG.colors.gridDim,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
      });

      const line = new THREE.Line(lineGeom, lineMat);
      this.group.add(line);
    }
  }

  setOpacity(val) {
    if (this.material) this.material.uniforms.uOpacity.value = val;

    // Also fade in the data streams
    this.group.children.forEach((child, i) => {
      if (i > 0 && child.material) { // Skip the grid plane
        child.material.opacity = val * 0.15;
      }
    });
  }

  setPulseIntensity(val) {
    if (this.material) this.material.uniforms.uPulseIntensity.value = val;
  }

  update(time) {
    if (this.material) {
      this.material.uniforms.uTime.value = time;
    }
  }
}
