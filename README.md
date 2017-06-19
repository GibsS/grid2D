# gridlike : A physics engine tailor-made for making 2D platformers

It is often difficult to handle the movement of your 2D platformer character using generic physics library. 
gridlike is built from the ground up with the intention of being used to make platformers. It also comes with
features that allow you to create modifiable grids like those of terraria or King arthur's gold.

Checkout the library in action here: https://gibss.github.io/test/gridlike/

# Install

```sh
npm install --save grid-like
```

# Simple usage

```js
var gridlike = require('grid-like')

var world = gridlike.createWorld()

var entity = world.createRect({
  x: 0, y: 0, width: 1, height: 1, level: 1
})

var ground = world.createRect({
  x: 0, y: -2, width: 10, height: 1, level: 0
})

for(var i = 0; i < 100; i++) {
  entity.vy = -10
  world.simulate(0.016)
  console.log("entity pos:", entity.x, entity.y)
}
```

# Test + Testbed

Tests are included with the library alongside a testbed: a simple web page that has a few very simple usage scenarios.

You can also find the testbed at https://gibss.github.io/test/gridlike/

*Setup*
```sh
git clone https://github.com/GibsS/gridlike.git
cd gridlike
npm install
```

*Run the tests:*
```sh
npm test
```

*Run the testbed:*
```sh
npm run build-testbed
firefox dist/testbed/index.html # Or whatever browser you choose
```

# State of the library

The library is still at a very early stage of development:
- Though the core features are implemented and usable to make a simple platformer, some of the more elaborate features remain to be implemented (The future of this library is bright, trust me ;))
- Test coverage is minimal
- The only documentation is the index.d.ts
- Quite a few bugs remain
- ..

These issues will be adressed as soon as possible and the missing features will be added. In the meantime, the library is perfectly fine to reproduce
the physics of games like super meat boy (without slopes), terraria (with ships if you so wish), super crate box, Super Mario Bros. (the first one ^^)..
