/**
 * MARKET POLARIS — THE LIVING MARKET
 * Configuration tokens for the cinematic 3D intro
 */
export const CONFIG = {
  colors: {
    bg: 0x030508,
    bgHex: '#030508',
    white: 0xE8ECF1,
    whiteHex: '#E8ECF1',
    blue: 0x3B82F6,
    blueHex: '#3B82F6',
    blueDeep: 0x1D4ED8,
    blueBright: 0x60A5FA,
    cyan: 0x06B6D4,
    gridDim: 0x0A1628,
    gridActive: 0x1E3A5F,
    particleDim: 0x0F2847,
    particleMid: 0x1E4976,
    particleBright: 0x3B82F6,
  },

  camera: {
    fov: 50,
    near: 0.1,
    far: 500,
    startPos: { x: 0, y: 0, z: 30 },
    pullBackPos: { x: 0, y: 0.5, z: 24 },
    finalPos: { x: 0, y: 0.3, z: 20 },
  },

  // Logo SVG path data — extracted from the authoritative brand mark
  logo: {
    bluePath: 'M 4.458,3.8482 L 2.4526,3.3424 L 2.9223,2.9088 L -0.131,0.009 L -1.4047,1.3098 L -4.0154,-1.1743 L -4.0154,-2.2674 L -1.4589,0.1174 L -0.1581,-1.1743 L 3.4824,2.3126 L 3.9792,1.7706 L 4.458,3.8482 Z',
    whitePath: 'M 3.5005,1.3369 L 3.1662,1.2737 L 2.9404,1.1472 L -0.1852,-1.8067 L -1.486,-0.5601 L -5.0,-3.8482 L -3.8528,-3.8482 L -1.5221,-1.6441 L -0.2304,-2.9088 L 3.3288,0.4336 L 3.4914,0.4968 L 3.6811,0.4788 L 3.8437,0.4065 L 4.0063,0.262 L 4.0967,0.1174 L 4.1509,-0.0723 L 4.1509,-0.2529 L 4.0967,-0.4426 L 3.9973,-0.6143 L 3.7715,-0.813 L 3.5727,-0.8943 L 2.4435,-0.9304 L 1.495,-1.8248 L 1.495,-3.8482 L 2.3532,-3.8482 L 2.3442,-1.2376 L 2.3713,-1.0659 L 2.4164,-0.9846 L 2.5158,-0.9124 L 2.6965,-0.9304 L 2.7055,-1.6802 L 2.6694,-1.7073 L 3.7082,-1.6983 L 4.1238,-1.5537 L 4.4309,-1.346 L 4.6296,-1.1472 L 4.7742,-0.9485 L 4.9006,-0.6865 L 4.9639,-0.4697 L 5.0,-0.2258 L 4.9639,0.2078 L 4.8826,0.4607 L 4.6929,0.7859 L 4.449,1.0298 L 4.1147,1.2285 L 3.7986,1.3189 L 3.5005,1.3369 Z',
    scale: 1.25, // Scale factor for the logo in world space
  },

  bloom: {
    strength: 0.6,
    radius: 0.4,
    threshold: 0.75,
  },

  particles: {
    count: 6000,
    fieldRadius: 35,
  },

  mouse: {
    springStiffness: 0.04,
    damping: 0.88,
    maxTilt: 0.15,
    parallaxScale: 0.8,
  },
};
