/**
 * MARKET POLARIS — Heartbeat Line
 * The first visual element: a luminous pulse line
 * that traces a market-chart-like heartbeat across the void
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class HeartbeatLine {
  constructor() {
    this.group = new THREE.Group();
    this.progress = 0;
    this.glow = 0;
    this.opacity = 0;

    this.build();
  }

  build() {
    // Generate heartbeat/market-chart path points
    const segments = 200;
    const width = 30; // World units wide
    this.totalPoints = segments;
    this.points = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = (t - 0.5) * width;

      // Create a market-chart-like waveform
      let y = 0;

      // Flat start
      if (t < 0.1) {
        y = 0;
      }
      // First small dip
      else if (t < 0.2) {
        const lt = (t - 0.1) / 0.1;
        y = -Math.sin(lt * Math.PI) * 1.2;
      }
      // Recovery
      else if (t < 0.3) {
        const lt = (t - 0.2) / 0.1;
        y = -1.2 + lt * 2.0;
      }
      // Sharp spike up
      else if (t < 0.4) {
        const lt = (t - 0.3) / 0.1;
        y = 0.8 + Math.sin(lt * Math.PI * 0.5) * 3.0;
      }
      // Peak hold
      else if (t < 0.45) {
        const lt = (t - 0.4) / 0.05;
        y = 3.8 - lt * 0.5;
      }
      // Sharp drop
      else if (t < 0.55) {
        const lt = (t - 0.45) / 0.1;
        y = 3.3 - Math.sin(lt * Math.PI * 0.5) * 5.0;
      }
      // Deep valley
      else if (t < 0.65) {
        const lt = (t - 0.55) / 0.1;
        y = -1.7 + Math.sin(lt * Math.PI) * 0.5 + lt * 3.0;
      }
      // Ascending trend
      else if (t < 0.8) {
        const lt = (t - 0.65) / 0.15;
        y = 1.3 + lt * 2.5 + Math.sin(lt * Math.PI * 2) * 0.4;
      }
      // Final peak
      else if (t < 0.9) {
        const lt = (t - 0.8) / 0.1;
        y = 3.8 + Math.sin(lt * Math.PI * 0.5) * 1.5;
      }
      // Trailing off
      else {
        const lt = (t - 0.9) / 0.1;
        y = 5.3 - lt * 1.0;
      }

      this.points.push(new THREE.Vector3(x, y * 0.6, 0));
    }

    // Main line geometry
    const lineGeom = new THREE.BufferGeometry();
    const positions = new Float32Array((segments + 1) * 3);
    const alphas = new Float32Array(segments + 1);

    for (let i = 0; i <= segments; i++) {
      positions[i * 3] = this.points[i].x;
      positions[i * 3 + 1] = this.points[i].y;
      positions[i * 3 + 2] = this.points[i].z;
      alphas[i] = 1.0;
    }

    lineGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    lineGeom.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

    // Custom shader for animated draw with glow
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uProgress: { value: 0.0 },
        uGlow: { value: 0.0 },
        uOpacity: { value: 0.0 },
        uTime: { value: 0.0 },
        uColor: { value: new THREE.Color(CONFIG.colors.blue) },
        uColorBright: { value: new THREE.Color(CONFIG.colors.blueBright) },
      },
      vertexShader: `
        attribute float aAlpha;
        uniform float uProgress;
        uniform float uGlow;
        uniform float uTime;
        
        varying float vAlpha;
        varying float vProgress;
        varying vec3 vPos;
        
        void main() {
          vPos = position;
          
          // Calculate which point this is (0-1)
          float totalWidth = 30.0;
          float normalizedX = (position.x + totalWidth * 0.5) / totalWidth;
          
          // Only show points up to current progress
          float drawn = step(normalizedX, uProgress);
          
          // Glow near the leading edge
          float edgeDist = abs(normalizedX - uProgress);
          float edgeGlow = exp(-edgeDist * 40.0) * uGlow;
          
          // Trail fade
          float trail = smoothstep(0.0, 0.3, uProgress - normalizedX + 0.3);
          
          vAlpha = drawn * (0.6 + edgeGlow * 2.0) * trail;
          vProgress = normalizedX;
          
          vec3 pos = position;
          // Subtle vertical oscillation for living feel
          pos.y += sin(uTime * 3.0 + normalizedX * 12.0) * 0.02 * drawn;
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        uniform float uProgress;
        uniform vec3 uColor;
        uniform vec3 uColorBright;
        
        varying float vAlpha;
        varying float vProgress;
        varying vec3 vPos;
        
        void main() {
          // Brighter near the leading edge
          float edgeDist = abs(vProgress - uProgress);
          float brightness = exp(-edgeDist * 30.0);
          
          vec3 color = mix(uColor, uColorBright, brightness * 0.7);
          // White hot at the tip
          color = mix(color, vec3(1.0), brightness * 0.4);
          
          float alpha = vAlpha * uOpacity;
          
          gl_FragColor = vec4(color, alpha);
        }
      `
    });

    this.line = new THREE.Line(lineGeom, this.material);
    this.group.add(this.line);

    // Glow particles along the line
    this.buildGlowParticles();

    // Position the heartbeat in the scene
    this.group.position.y = 1.5;
    this.group.position.z = 2;
  }

  buildGlowParticles() {
    const count = 60;
    const positions = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const linePositions = new Float32Array(count); // Normalized position along line

    for (let i = 0; i < count; i++) {
      const t = i / count;
      const idx = Math.floor(t * this.totalPoints);
      const pt = this.points[Math.min(idx, this.points.length - 1)];

      positions[i * 3] = pt.x + (Math.random() - 0.5) * 0.3;
      positions[i * 3 + 1] = pt.y + (Math.random() - 0.5) * 0.3;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
      randoms[i] = Math.random();
      linePositions[i] = t;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
    geom.setAttribute('aLinePos', new THREE.BufferAttribute(linePositions, 1));

    this.glowMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uProgress: { value: 0.0 },
        uGlow: { value: 0.0 },
        uOpacity: { value: 0.0 },
        uTime: { value: 0.0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        attribute float aRandom;
        attribute float aLinePos;
        
        uniform float uProgress;
        uniform float uGlow;
        uniform float uOpacity;
        uniform float uTime;
        uniform float uPixelRatio;
        
        varying float vAlpha;
        
        void main() {
          float drawn = step(aLinePos, uProgress);
          float edgeDist = abs(aLinePos - uProgress);
          float edgeGlow = exp(-edgeDist * 20.0) * uGlow;
          
          vec3 pos = position;
          pos += vec3(
            sin(uTime * 2.0 + aRandom * 10.0) * 0.15,
            cos(uTime * 1.5 + aRandom * 8.0) * 0.15,
            sin(uTime * 1.8 + aRandom * 6.0) * 0.1
          );
          
          vAlpha = drawn * (0.15 + edgeGlow * 1.5) * uOpacity;
          
          vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPos;
          gl_PointSize = (3.0 + edgeGlow * 8.0 + aRandom * 2.0) * uPixelRatio * (80.0 / -mvPos.z);
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        
        void main() {
          vec2 coord = gl_PointCoord - vec2(0.5);
          float d = dot(coord, coord);
          if (d > 0.25) discard;
          
          float glow = exp(-d * 8.0);
          vec3 color = mix(vec3(0.23, 0.51, 0.96), vec3(0.6, 0.8, 1.0), glow);
          
          gl_FragColor = vec4(color, glow * vAlpha);
        }
      `
    });

    const points = new THREE.Points(geom, this.glowMaterial);
    this.group.add(points);
  }

  setProgress(val) {
    this.progress = val;
  }

  setGlow(val) {
    this.glow = val;
  }

  setOpacity(val) {
    this.opacity = val;
  }

  update(time) {
    if (this.material) {
      this.material.uniforms.uProgress.value = this.progress;
      this.material.uniforms.uGlow.value = this.glow;
      this.material.uniforms.uOpacity.value = this.opacity;
      this.material.uniforms.uTime.value = time;
    }
    if (this.glowMaterial) {
      this.glowMaterial.uniforms.uProgress.value = this.progress;
      this.glowMaterial.uniforms.uGlow.value = this.glow;
      this.glowMaterial.uniforms.uOpacity.value = this.opacity;
      this.glowMaterial.uniforms.uTime.value = time;
    }
  }
}
