import { ScenarioPreset } from '../types';

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: 'credenza',
    title: 'Mid-Century Credenza Lighting',
    category: 'Interior Styling · Warm Walnut',
    imagePath: '/src/assets/images/scene_midcentury_credenza_1795288498051.jpg',
    spokenPrompt:
      'Find a small cordless lamp for that empty tray on the left end of the walnut credenza under a hundred twenty dollars.',
    noisyBackgroundHint: 'Afternoon living room with faint street traffic outside',
    panPattern: 'slow-pan',
    whatTextLoses:
      'Raw frames reveal the recessed rectangular tray on the left edge, warm oiled walnut grain, plaster wall daylight angle, and travertine coaster texture—scale and finish constraints a text query omits.',
  },
  {
    id: 'workbench',
    title: 'Cluttered Hardware Workbench',
    category: 'Desk Organization · Dark Oak',
    imagePath: '/src/assets/images/scene_cluttered_workbench_1795288497448.jpg',
    spokenPrompt:
      'Look at these tangled keyboard cables next to my pour-over carafe, get me a dark coiled cable or desk organizer that matches this setup.',
    noisyBackgroundHint: 'Mechanical keyboard clatter and studio fan hum',
    panPattern: 'rack-focus',
    whatTextLoses:
      'Raw pixels expose the 65% anodized silver keyboard, matte black desk mat, brass ruler, and open orange-braided cable pile requiring compact footprint rather than bulky trays.',
  },
  {
    id: 'shelf',
    title: '15-Item Boutique Shelf',
    category: 'Visual Disambiguation · Retail Shelf',
    imagePath: '/src/assets/images/scene_thrift_shelf_1795288499185.jpg',
    spokenPrompt:
      'Not the speckled mugs—match that matte black kettle in the center with folded sage waffle towels beside it.',
    noisyBackgroundHint: 'Overlapping cafe espresso grinder and retail chatter',
    panPattern: 'whip-pan',
    whatTextLoses:
      'With 15+ overlapping stoneware vessels, spoken negative constraints ("not the speckled mugs") combined with spatial center framing disambiguate the gooseneck kettle and olive waffle linen.',
  },
  {
    id: 'studio',
    title: 'Acoustic Creator Studio',
    category: 'Audio Gear · Walnut Slat Wall',
    imagePath: '/src/assets/images/scene_audio_studio_1795288497531.jpg',
    spokenPrompt:
      'I need a clean desk mug or acoustic headphone stand that blends into this walnut slat desk without cluttering the mic arm.',
    noisyBackgroundHint: 'Monitor hum and ambient room reverb',
    panPattern: 'low-light-scan',
    whatTextLoses:
      'Camera shows tight clearance under the low-profile boom arm and dark matte aluminum monitors, ruling out tall stands that would collide with the broadcast mic.',
  },
];
