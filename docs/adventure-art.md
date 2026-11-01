# v0.4.1 美术来源

## 旅行者（内置图片生成，透明背景）

文件：`public/art/adventure/traveler.png`；用于替代战斗中玩家的文字占位。已核验 RGBA 通道与透明角落。

生成提示：Use case: stylized-concept. Asset type: transparent full-body player character sprite for a sunny hand-painted storybook card adventure. An original friendly young ADULT traveler, gender-neutral appearance, short dark chestnut hair, curious warm expression, a soft moss-green short cloak over an ivory shirt and comfortable tan trousers, a small leather satchel with a few illustrated cards peeking out, sturdy rounded boots. Holding a small glowing amber lantern in one hand and a fan of three blank-backed cream game cards in the other. Facing slightly RIGHT toward an opponent, relaxed confident adventuring stance. Kind and welcoming for a broad audience, human proportions stylized but clearly a young adult. Sophisticated gouache storybook texture, warm sunlight, sage/ivory/honey colors matching a cheerful stone garden town. Full body and all props entirely in frame with generous padding; clean readable silhouette for a small mobile game arena. Genuine transparent background; no landscape, ground plane, words, letters, numbers, logos, card text, border, UI, weapons or franchise character references.

## 钟表鸟（内置图片生成，透明背景）

文件：`public/art/adventure/clock.png`。

初始提示：Use case: stylized-concept. Asset type: transparent full-body character sprite for a sunny hand-painted storybook card adventure. An original cheerful pendulum clock attendant: a small round pale blue and honey brass clockwork bird with a cream clock face belly, round expressive eyes, tiny copper wings, short sturdy feet, a little dangling pendulum and leaf-shaped wind-up key. Playful determined sparring stance facing slightly left, looks like a friendly town helper giving a challenge. Sophisticated gouache storybook illustration, warm daylight and tactile brush texture, readable silhouette. Isolated whole character centered with generous padding on genuine transparent background. No landscape or ground plane, no text, numbers on the clock face, watermark, border, UI, horror, realistic weapons or franchise elements.

用户要求去除胸口钟面下方悬挂圆球，最终文件使用编辑后的版本。

编辑提示：Edit this exact transparent character sprite. Remove ONLY the small hanging golden ball/pendulum bob and its short connecting rod that dangles BELOW the chest clock, between the bird's legs. Replace that removed area with genuine transparent background, preserving the natural uninterrupted lower edge of the clock and the bird body. Keep the chest clock face, hands and rim intact. Preserve every other feature: blue bird, pose, both legs and feet, wings, face, wind-up key, colors, brush texture, proportions, full image framing and transparency. No replacement ornament, no new hanging object. The rest of the image should remain unchanged.

## 苔壳卫兵（内置图片生成，透明背景）

文件：`public/art/adventure/moss.png`。

初始提示：Use case: stylized-concept. Asset type: transparent full-body character sprite for a sunny hand-painted storybook card adventure. An original friendly moss-shell garden sentinel: a squat rounded ivory stone creature with a leafy green shell, small fern sprouts and daisies growing on its shoulders, warm curious amber eyes, broad little feet, kindly smile. A playful sturdy sparring stance, facing slightly left. Gouache and watercolor paper textures, crisp readable silhouette, warm daylight, soft sage and cream palette, approachable magic for broad audiences. Isolated entire figure centered with generous padding. Genuine transparent background. No backdrop or ground plane, no text, watermark, frame, UI, grimness, scary teeth or franchise elements.


## 制作与使用

- 工具：OpenAI 内置 GPT Image 图片生成工具；使用 ImageGen 技能工作流。图片是开发期生成资产，运行时不调用图片生成服务。
- 用户视觉要求：阳光、亲切、面向更大大众。最初生成的夜景因过于阴森已放弃，不用于当前 demo。
- 场景：`public/art/adventure/morning-city.png`。基于初版原创场景改为白天，保留小城、路径与灯塔，采用暖石墙、蓝天、绿植和浅雾。
- 守灯者：`public/art/adventure/guardian.png`，透明背景的亲切黄铜灯火守护者。
- 必要卡牌数值、规则及按钮使用真实文字和程序界面，不嵌入生成图片。
- 不使用现成商业游戏角色、商标、卡面或未核验授权素材。

## 最终场景提示（内置图片编辑）

Use case: lighting-weather and style-transfer. Edit the provided portrait game environment illustration into an inviting SUNNY DAYTIME fairytale town for a broad general audience. Preserve the appealing layered town, winding cobblestone pathway and distant lantern tower as an original setting, but substantially open up and brighten the composition. Warm honey and cream stone buildings with terracotta and soft teal roofs, abundant fresh green plants, little flowers, pale blue open sky with a few soft clouds, gentle morning sunlight, only a little luminous light mist in the far distance. Widen the visual feel of the foreground passage, remove the threatening dark overhanging framing and all night sky, moon, spooky shadows, gothic oppression and ruined atmosphere. The tower should look friendly and curious, not ominous. Beautiful original gouache storybook game art with soft rich paint texture and warm optimistic charm. A calm lower foreground for UI, tall portrait 2:3. No characters, text, lettering, logos, watermarks, card frames or UI. Make it genuinely cheerful, daylight and welcoming, not just a brighter version of a gloomy scene.

源图为本次先前生成的原创图片，不是第三方素材。最后选用的资产已复制到仓库目录，构建不依赖个人生成缓存。

## 守灯者提示（内置图片生成，透明背景）

Use case: stylized-concept. Asset type: isolated transparent full-body character sprite for a bright welcoming hand-painted storybook card adventure. Subject: the Lantern Keeper, a friendly round brass-and-ivory clockwork guardian with a warm glowing lantern at its heart, small teal enamel shoulder pieces, a soft cream cape, rounded boots, tiny leaf details, and a kindly expressive face. Standing confidently with a short ceremonial lantern staff, a playful challenging pose, facing slightly left toward the player. It should feel like an approachable magical town caretaker inviting a friendly trial, suitable for broad audiences. Original design, gouache texture and illustrated details, warm sunlight, soft contour, well-defined readable silhouette. Entire character and staff fully inside frame, centered with generous transparent padding. Genuine transparent background, no landscape, no ground plane, no text, labels, numbers, logo, watermark, card border, UI. No weapons that look realistic, no frightening faces, no darkness or franchise references.
