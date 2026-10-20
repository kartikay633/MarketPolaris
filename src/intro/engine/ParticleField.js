/**
 * MARKET POLARIS — Particle Field
 * Intelligent particle system that forms the ambient market data atmosphere
 * Particles flow in structured streams, converge toward center during logo birth
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class ParticleField {
  constructor() {
    this.group = new THREE.Group();
    this.count = CONFIG.particles.count;
    this.build();
  }

  build() {
    const count = this.count;
    const geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const randoms = new Float32Array(count * 3);

    const cDim = new THREE.Color(CONFIG.colors.particleDim);
    const cMid = new THREE.Color(CONFIG.colors.particleMid);
    const cBright = new THREE.Color(CONFIG.colors.particleBright);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const r = Math.random();

      // Spatial distribution — organized into meaningful patterns
      const type = i % 7;
      let x, y, z;

      if (type < 3) {
        // Flowing horizontal streams (like market data feeds)
        const stream = Math.floor(Math.random() * 8);
        const streamY = (stream - 3.5) * 2.5;
        x = (Math.random() - 0.5) * CONFIG.particles.fieldRadius * 2;
        y = streamY + (Math.random() - 0.5) * 1.5;
        z = (Math.random() - 0.5) * CONFIG.particles.fieldRadius;
      } else if (type < 5) {
        // Ascending diagonal trajectories
        const t = (Math.random() - 0.5) * 40;
        x = t + (Math.random() - 0.5) * 3;
        y = t * 0.5 + (Math.random() - 0.5) * 2;
        z = (Math.random() - 0.5) * 20;
      } else if (type === 5) {
        // Core cluster near center
        const rad = Math.pow(Math.random(), 2) * 10;
        const angle = Math.random() * Math.PI * 2;
        x = Math.cos(angle) * rad;
        y = Math.sin(angle) * rad * 0.5;
        z = (Math.random() - 0.5) * 8;
      } else {
        // Distant sparse atmosphere
        const phi = (Math.random() - 0.5) * Math.PI;
        const theta = Math.random() * Math.PI * 2;
        const dist = 20 + Math.random() * 25;
        x = dist * Math.cos(phi) * Math.cos(theta);
        y = dist * Math.sin(phi) * 0.4;
        z = dist * Math.cos(phi) * Math.sin(theta);
      }

      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = z;

      // Flow velocities
      velocities[i3] = (Math.random() - 0.3) * 0.5; // Slight rightward bias
      velocities[i3 + 1] = (Math.random() - 0.5) * 0.2;
      velocities[i3 + 2] = (Math.random() - 0.5) * 0.1;

      // Color hierarchy
      let col;
      if (r < 0.65) col = cDim;
      else if (r < 0.88) col = cMid;
      else col = cBright;

      colors[i3] = col.r;
      colors[i3 + 1] = col.g;
      colors[i3 + 2] = col.b;

      sizes[i] = r < 0.65 ? 1.0 + Math.random() * 0.5 :
                 r < 0.88 ? 1.8 + Math.random() * 0.8 :
                           2.8 + Math.random() * 1.5;

      randoms[i3] = Math.random();
      randoms[i3 + 1] = Math.random();
      randoms[i3 + 2] = Math.random();
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 3));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uGlobalAlpha: { value: 0.0 },
        uSpread: { value: 0.0 },
        uConvergence: { value: 0.0 },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        attribute vec3 aVelocity;
        attribute vec3 aColor;
        attribute float aSize;
        attribute vec3 aRandom;
        
        uniform float uTime;
        uniform float uGlobalAlpha;
        uniform float uSpread;
        uniform float uConvergence;
        uniform vec2 uMouse;
        uniform float uPixelRatio;
        
        varying vec3 vColor;
        varying float vAlpha;
        
        void main() {
          vec3 pos = position;
          
          // 1. Organic drift motion
          float t = uTime * 0.3 + aRandom.x * 6.28;
          pos.x += sin(t + pos.y * 0.05) * 0.3 * uSpread;
          pos.y += cos(t * 0.7 + pos.x * 0.04) * 0.25 * uSpread;
          pos.z += sin(t * 0.5 + pos.z * 0.03) * 0.2 * uSpread;
          
          // 2. Flow velocity
          pos += aVelocity * uTime * 0.15;
          
          // 3. Convergence toward center (logo birth)
          if (uConvergence > 0.001) {
            vec3 toCenter = -pos;
            float dist = length(toCenter);
            vec3 pullDir = normalize(toCenter);
            
            // Spiral convergence
            float spiralAngle = uConvergence * 3.14 * 2.0 + aRandom.y * 6.28;
            vec3 spiral = vec3(
              pullDir.x * cos(spiralAngle) - pullDir.y * sin(spiralAngle),
              pullDir.x * sin(spiralAngle) + pullDir.y * cos(spiralAngle),
              pullDir.z
            );
            
            float pullStrength = uConvergence * (1.0 + 2.0 / (dist + 1.0));
            pos += spiral * pullStrength * 3.0;
            
            // Compress toward center
            pos *= mix(1.0, 0.15, uConvergence * uConvergence);
          }
          
          // 4. Mouse repulsion
          vec2 mouseWorld = uMouse * 8.0;
          vec2 diff = pos.xy - mouseWorld;
          float mouseDist = length(diff);
          if (mouseDist < 5.0 && mouseDist > 0.01) {
            float push = (1.0 - mouseDist / 5.0) * 0.5;
            pos.xy += normalize(diff) * push;
          }
          
          // Color
          vColor = aColor;
          
          // Enhanced color near convergence
          if (uConvergence > 0.3) {
            float dist = length(pos);
            float nearCenter = exp(-dist * 0.3);
            vColor = mix(vColor, vec3(0.37, 0.65, 1.0), nearCenter * uConvergence * 0.5);
          }
          
          // Alpha
          float distFade = 1.0 - smoothstep(15.0, 35.0, length(position));
          vAlpha = uGlobalAlpha * (0.3 + aRandom.z * 0.7) * distFade;
          
          vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPos;
          
          float convergenceScale = mix(1.0, 1.5, uConvergence);
          gl_PointSize = max(1.5, aSize * uPixelRatio * (85.0 / -mvPos.z) * convergenceScale);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        
        void main() {
          vec2 coord = gl_PointCoord - vec2(0.5);
          float d2 = dot(coord, coord);
          if (d2 > 0.25) discard;
          
          float glow = smoothstep(0.25, 0.0, d2);
          float core = exp(-d2 * 18.0);
          
          vec3 col = vColor + vec3(core * 0.3);
          float alpha = (glow * 0.4 + core * 0.6) * vAlpha;
          
          gl_FragColor = vec4(col, alpha);
        }
      `
    });

    this.points = new THREE.Points(geometry, this.material);
    this.group.add(this.points);
  }

  setGlobalAlpha(val) {
    if (this.material) this.material.uniforms.uGlobalAlpha.value = val;
  }

  setSpread(val) {
    if (this.material) this.material.uniforms.uSpread.value = val;
  }

  setConvergence(val) {
    if (this.material) this.material.uniforms.uConvergence.value = val;
  }

  update(time, mouseX, mouseY) {
    if (this.material) {
      this.material.uniforms.uTime.value = time;
      this.material.uniforms.uMouse.value.set(mouseX || 0, mouseY || 0);
    }
  }
}
