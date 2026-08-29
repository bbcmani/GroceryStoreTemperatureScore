// =====================================================
// 3D / 4D aisle visualization (classic script using the global THREE UMD build —
// intentionally not an ES module so this works over plain file:// URLs in any browser).
// Exposes window.Aisle3D.render(...) for dashboard.js to drive.
// =====================================================
(function () {
    let scene, camera, renderer, container, cubeGroup;
    let raycaster, mouse, clickables = [];
    let onCellClick = null;
    const VIEW_HEIGHT = 480;

    // Minimal hand-rolled orbit control (drag to rotate, wheel to zoom) around a fixed target,
    // avoiding a dependency on three.js's OrbitControls ES module.
    let target, spherical = { radius: 16, theta: 0.9, phi: 1.0 };
    let dragging = false, lastX = 0, lastY = 0;

    function updateCameraFromSpherical() {
        const phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
        const x = target.x + spherical.radius * Math.sin(phi) * Math.sin(spherical.theta);
        const y = target.y + spherical.radius * Math.cos(phi);
        const z = target.z + spherical.radius * Math.sin(phi) * Math.cos(spherical.theta);
        camera.position.set(x, y, z);
        camera.lookAt(target);
    }

    function attachControls(dom) {
        dom.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
        window.addEventListener('mouseup', () => { dragging = false; });
        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - lastX, dy = e.clientY - lastY;
            lastX = e.clientX; lastY = e.clientY;
            spherical.theta -= dx * 0.01;
            spherical.phi -= dy * 0.01;
            updateCameraFromSpherical();
        });
        dom.addEventListener('wheel', (e) => {
            e.preventDefault();
            spherical.radius = Math.max(4, Math.min(40, spherical.radius + e.deltaY * 0.01));
            updateCameraFromSpherical();
        }, { passive: false });
    }

    function ensureScene() {
        if (renderer) return;
        container = document.getElementById('aisle3dContainer');
        const width = container.clientWidth || 600;

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf5f7fa);

        camera = new THREE.PerspectiveCamera(50, width / VIEW_HEIGHT, 0.1, 100);
        target = new THREE.Vector3(2.5, 1.5, 2.5);
        updateCameraFromSpherical();

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, VIEW_HEIGHT);
        renderer.setPixelRatio(window.devicePixelRatio || 1);
        container.appendChild(renderer.domElement);
        attachControls(renderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 0.9));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
        dirLight.position.set(6, 12, 8);
        scene.add(dirLight);

        cubeGroup = new THREE.Group();
        scene.add(cubeGroup);

        raycaster = new THREE.Raycaster();
        mouse = new THREE.Vector2();

        renderer.domElement.addEventListener('click', handleClick);
        window.addEventListener('resize', handleResize);

        animate();
    }

    function handleResize() {
        if (!container || !renderer) return;
        const width = container.clientWidth || 600;
        camera.aspect = width / VIEW_HEIGHT;
        camera.updateProjectionMatrix();
        renderer.setSize(width, VIEW_HEIGHT);
    }

    function animate() {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
    }

    // Same cold(blue)->hot(red) hue scale used by the 2D heatmap, roughly -20C to 35C.
    function tempToColor(temp) {
        const t = Math.max(0, Math.min(1, (temp + 20) / 55));
        const hue = (1 - t) * 220;
        return new THREE.Color(`hsl(${hue}, 70%, 55%)`);
    }

    function makeLabelSprite(text) {
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#111827';
        ctx.font = 'bold 30px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
        sprite.scale.set(1.3, 0.65, 1);
        return sprite;
    }

    function handleClick(event) {
        if (!onCellClick) return;
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(clickables, false);
        if (hits.length) onCellClick(hits[0].object.userData.cell);
    }

    // options: { grid: {X,Y,Z}, cells: [{x,y,z,temp,product,isSelected,isNeighbor}], onCellSelect(cell) }
    function render(options) {
        ensureScene();
        const { grid, cells, onCellSelect } = options;
        onCellClick = onCellSelect || null;

        cubeGroup.clear();
        clickables = [];

        const spacing = 1.6;
        const offsetX = (grid.X - 1) * spacing / 2;
        const offsetY = (grid.Z - 1) * spacing / 2; // shelf level (z) maps to vertical axis in 3D
        const offsetZ = (grid.Y - 1) * spacing / 2;

        for (const cell of cells) {
            const size = cell.product ? 1.15 : 0.6;
            const geometry = new THREE.BoxGeometry(size, size, size);
            const highlight = cell.isSelected ? 0x2563eb : cell.isNeighbor ? 0xf59e0b : 0x000000;
            const material = new THREE.MeshStandardMaterial({
                color: tempToColor(cell.temp),
                transparent: !cell.product,
                opacity: cell.product ? 1 : 0.3,
                emissive: new THREE.Color(highlight),
                emissiveIntensity: cell.isSelected ? 0.7 : cell.isNeighbor ? 0.55 : 0
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(cell.x * spacing - offsetX, cell.z * spacing - offsetY, cell.y * spacing - offsetZ);
            mesh.userData.cell = cell;
            cubeGroup.add(mesh);
            clickables.push(mesh);

            if (cell.product) {
                const label = makeLabelSprite(cell.product.id.replace('PR', 'P'));
                label.position.set(mesh.position.x, mesh.position.y + size / 2 + 0.55, mesh.position.z);
                cubeGroup.add(label);
            }

            if (cell.isSelected || cell.isNeighbor) {
                const edges = new THREE.EdgesGeometry(geometry);
                const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: highlight }));
                line.position.copy(mesh.position);
                cubeGroup.add(line);
            }
        }
    }

    window.Aisle3D = { render };
})();

