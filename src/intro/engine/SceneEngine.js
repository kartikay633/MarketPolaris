/**
 * MARKET POLARIS — Scene Engine
 * Core Three.js scene with physically-based lighting and bloom post-processing
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CONFIG } from '../config.js';

// Custom flash/overlay shader
const FlashShader = {
  uniforms: {
    tDiffuse: { value: null },
    uFlash: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uFlash;
    varying vec2 vUv;
    
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      
      // Cinematic flash — white with blue tint
      vec3 flashColor = mix(vec3(0.7, 0.85, 1.0), vec3(1.0), 0.5);
      texel.rgb = mix(texel.rgb, flashColor, uFlash * 0.85);
      
      // Subtle vignette
      vec2 center = vUv - vec2(0.5);
      float vignette = 1.0 - dot(center, center) * 1.2;
      texel.rgb *= mix(0.7, 1.0, vignette);
      
      // Film grain
      float grain = (fract(sin(dot(vUv * 1000.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.015;
      texel.rgb += grain;
      
      gl_FragColor = texel;
    }
  `
};

export class SceneEngine {
  constructor(container) {
    this.container = container;
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(CONFIG.colors.bg);
    this.scene.fog = new THREE.FogExp2(CONFIG.colors.bg, 0.012);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.camera.fov,
      this.width / this.height,
      CONFIG.camera.near,
      CONFIG.camera.far
    );
    this.camera.position.set(
      CONFIG.camera.startPos.x,
      CONFIG.camera.startPos.y,
      CONFIG.camera.startPos.z
    );

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      powerPreference: 'high-performance',
      antialias: true,
      alpha: false,
      stencil: false,
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    // Lighting
    this.setupLighting();

    // Post-processing
    this.setupPostProcessing();

    // Resize
    window.addEventListener('resize', this.onResize.bind(this));
  }

  setupLighting() {
    // Ambient — deep blue atmospheric
    const ambient = new THREE.AmbientLight(0x0A1628, 1.0);
    this.scene.add(ambient);

    // Key light — warm white from upper-left
    const key = new THREE.DirectionalLight(0xF0F4F8, 2.2);
    key.position.set(-5, 8, 10);
    this.scene.add(key);

    // Rim light — electric blue backlight
    const rim = new THREE.DirectionalLight(CONFIG.colors.blue, 3.0);
    rim.position.set(6, -2, -8);
    this.scene.add(rim);

    // Fill — subtle cool from below
    const fill = new THREE.DirectionalLight(0x1E3A5F, 0.8);
    fill.position.set(-2, -6, 5);
    this.scene.add(fill);

    // Point light — blue accent near center
    const point = new THREE.PointLight(CONFIG.colors.blue, 1.5, 25);
    point.position.set(0, 0, 5);
    this.scene.add(point);
    this.accentLight = point;

    // Generate simple environment map for PBR reflections
    this.generateEnvironment();
  }

  generateEnvironment() {
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    
    // Create a simple gradient environment scene
    const envScene = new THREE.Scene();
    
    // Dark blue gradient sphere
    const envGeom = new THREE.SphereGeometry(50, 32, 32);
    const envMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {},
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPos;
        void main() {
          vec3 dir = normalize(vWorldPos);
          float y = dir.y * 0.5 + 0.5;
          
          // Deep space gradient with subtle blue
          vec3 bottom = vec3(0.01, 0.02, 0.04);
          vec3 mid = vec3(0.03, 0.06, 0.12);
          vec3 top = vec3(0.05, 0.1, 0.2);
          
          vec3 color = mix(bottom, mid, smoothstep(0.0, 0.5, y));
          color = mix(color, top, smoothstep(0.5, 1.0, y));
          
          // Subtle specular highlights
          float highlight1 = pow(max(0.0, dot(dir, normalize(vec3(-0.5, 0.7, 0.5)))), 64.0);
          float highlight2 = pow(max(0.0, dot(dir, normalize(vec3(0.6, -0.3, -0.5)))), 32.0);
          
          color += vec3(0.8, 0.85, 0.9) * highlight1 * 0.15;
          color += vec3(0.2, 0.4, 0.8) * highlight2 * 0.1;
          
          gl_FragColor = vec4(color, 1.0);
        }
      `
    });
    
    const envMesh = new THREE.Mesh(envGeom, envMat);
    envScene.add(envMesh);
    
    const envMap = pmremGenerator.fromScene(envScene, 0.04).texture;
    this.scene.environment = envMap;
    
    pmremGenerator.dispose();
    envScene.clear();
  }

  setupPostProcessing() {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);

    this.composer = new EffectComposer(this.renderer);

    // Render pass
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Bloom
    this.bloomPass = new UnrealBloomPass(
      size,
      CONFIG.bloom.strength,
      CONFIG.bloom.radius,
      CONFIG.bloom.threshold
    );
    this.composer.addPass(this.bloomPass);

    // Flash + film grain + vignette
    this.flashPass = new ShaderPass(FlashShader);
    this.composer.addPass(this.flashPass);

    // Output
    this.composer.addPass(new OutputPass());
  }

  setFlashIntensity(val) {
    if (this.flashPass) {
      this.flashPass.uniforms.uFlash.value = val;
    }
  }

  onResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(this.width, this.height);
  }

  render() {
    this.composer.render();
  }

  dispose() {
    window.removeEventListener('resize', this.onResize.bind(this));
    this.renderer.dispose();
  }
}
