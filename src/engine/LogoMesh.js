/**
 * MARKET POLARIS — Logo Mesh
 * Precision 3D extruded logo from SVG path data
 * Uses the authoritative brand mark paths
 */
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { CONFIG } from '../config.js';

export class LogoMesh {
  constructor() {
    this.group = new THREE.Group();
    this.whiteMesh = null;
    this.blueMesh = null;
    this.whiteMaterial = null;
    this.blueMaterial = null;
    this.edgeLines = [];

    this.build();
    this.group.visible = false;
    this.group.scale.setScalar(CONFIG.logo.scale);
  }

  parseSVGPath(pathString) {
    // Create a temporary SVG to use the SVGLoader parser
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${pathString}"/></svg>`;
    const loader = new SVGLoader();
    const svgData = loader.parse(svgString);
    
    if (svgData.paths.length > 0) {
      const shapes = SVGLoader.createShapes(svgData.paths[0]);
      return shapes;
    }
    return [];
  }

  buildShapeFromPath(pathData) {
    // Parse path coordinates manually for reliability
    const commands = pathData.match(/[MLHVCSQTAZ][^MLHVCSQTAZ]*/gi);
    if (!commands) return new THREE.Shape();

    const shape = new THREE.Shape();
    let firstMove = true;

    for (const cmd of commands) {
      const type = cmd[0];
      const coords = cmd.slice(1).trim().split(/[\s,]+/).map(Number);

      switch (type) {
        case 'M':
          if (firstMove) {
            shape.moveTo(coords[0], coords[1]);
            firstMove = false;
          } else {
            shape.moveTo(coords[0], coords[1]);
          }
          break;
        case 'L':
          for (let i = 0; i < coords.length; i += 2) {
            shape.lineTo(coords[i], coords[i + 1]);
          }
          break;
        case 'Z':
          shape.closePath();
          break;
      }
    }

    return shape;
  }

  build() {
    // Build shapes from SVG path data
    const blueShape = this.buildShapeFromPath(CONFIG.logo.bluePath);
    const whiteShape = this.buildShapeFromPath(CONFIG.logo.whitePath);

    // Extrusion — crisp technological bevel
    const extrudeSettings = {
      steps: 2,
      depth: 0.45,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.05,
      bevelOffset: 0,
      bevelSegments: 5,
    };

    const blueGeom = new THREE.ExtrudeGeometry(blueShape, extrudeSettings);
    const whiteGeom = new THREE.ExtrudeGeometry(whiteShape, extrudeSettings);

    // Center geometries
    blueGeom.computeBoundingBox();
    whiteGeom.computeBoundingBox();

    // Compute combined center
    const allBox = new THREE.Box3();
    allBox.union(blueGeom.boundingBox);
    allBox.union(whiteGeom.boundingBox);
    const center = new THREE.Vector3();
    allBox.getCenter(center);

    blueGeom.translate(-center.x, -center.y, -center.z);
    whiteGeom.translate(-center.x, -center.y, -center.z);

    // Materials — premium physical
    this.whiteMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(CONFIG.colors.white),
      metalness: 0.12,
      roughness: 0.18,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
      reflectivity: 0.85,
      transparent: true,
      opacity: 0,
      envMapIntensity: 1.2,
      side: THREE.DoubleSide,
    });

    this.blueMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(CONFIG.colors.blue),
      emissive: new THREE.Color(CONFIG.colors.blueDeep),
      emissiveIntensity: 0.3,
      metalness: 0.2,
      roughness: 0.15,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      reflectivity: 0.95,
      transparent: true,
      opacity: 0,
      envMapIntensity: 1.5,
      side: THREE.DoubleSide,
    });

    this.whiteMesh = new THREE.Mesh(whiteGeom, this.whiteMaterial);
    this.blueMesh = new THREE.Mesh(blueGeom, this.blueMaterial);

    // Blue slightly forward
    this.blueMesh.position.z = 0.03;

    // Edge highlights
    const blueEdges = new THREE.EdgesGeometry(blueGeom, 30);
    const whiteEdges = new THREE.EdgesGeometry(whiteGeom, 30);

    const edgeMat = new THREE.LineBasicMaterial({
      color: CONFIG.colors.blueBright,
      transparent: true,
      opacity: 0,
      linewidth: 1,
    });
    this.edgeMaterial = edgeMat;

    const blueEdgeLine = new THREE.LineSegments(blueEdges, edgeMat.clone());
    const whiteEdgeLine = new THREE.LineSegments(whiteEdges, edgeMat.clone());
    blueEdgeLine.position.z = 0.03;

    this.edgeLines.push(blueEdgeLine, whiteEdgeLine);

    this.group.add(this.whiteMesh);
    this.group.add(this.blueMesh);
    this.group.add(blueEdgeLine);
    this.group.add(whiteEdgeLine);
  }

  setOpacity(val) {
    if (this.whiteMaterial) this.whiteMaterial.opacity = val;
    if (this.blueMaterial) this.blueMaterial.opacity = val;
    // Subtle edge glow
    for (const line of this.edgeLines) {
      if (line.material) line.material.opacity = val * 0.25;
    }
  }
}
