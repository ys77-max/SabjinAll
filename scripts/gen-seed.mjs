// Generates functions/src/seed/seedItems.json (West India / Maharashtra seasons).
// Row: id, en, hi, mr, category, unit, qty, shelfLifeDays, seasonMonths ([]=all year), rotation, peakMonths
import { writeFileSync } from 'node:fs';
const A = [];
const r = (a, b) => { const o = []; let m = a; for (;;) { o.push(m); if (m === b) break; m = m === 12 ? 1 : m + 1; } return o; };
const rows = [
  // leafy
  ['spinach','Spinach','पालक','पालक','leafy','bunch',2,3,A,'weekly',[11,12,1,2]],
  ['fenugreek','Fenugreek leaves','मेथी','मेथी','leafy','bunch',2,2,r(10,3),'weekly',[12,1]],
  ['dill','Dill','सोआ','शेपू','leafy','bunch',1,2,r(10,3),'biweekly',[12,1]],
  ['red-amaranth','Red amaranth','लाल चौलाई','लाल माठ','leafy','bunch',1,2,A,'biweekly',[6,7,8]],
  ['spring-onion','Spring onion','हरा प्याज','कांद्याची पात','leafy','bunch',1,4,r(10,3),'biweekly',[12,1]],
  ['mustard-greens','Mustard greens','सरसों का साग','मोहरीची भाजी','leafy','bunch',1,3,r(11,2),'on_demand',[12,1]],
  ['colocasia-leaves','Colocasia leaves','अरबी के पत्ते','अळूची पाने','leafy','bunch',1,2,r(6,10),'on_demand',[7,8]],
  ['drumstick-leaves','Drumstick leaves','सहजन के पत्ते','शेवग्याची पाने','leafy','bunch',1,2,A,'on_demand',[]],
  // herb
  ['coriander','Coriander','धनिया','कोथिंबीर','herb','bunch',2,4,A,'weekly',[11,12,1]],
  ['mint','Mint','पुदीना','पुदिना','herb','bunch',1,3,A,'biweekly',[3,4,5]],
  ['curry-leaves','Curry leaves','करी पत्ता','कढीपत्ता','herb','bunch',1,7,A,'biweekly',[]],
  ['green-chilli','Green chilli','हरी मिर्च','हिरवी मिरची','herb','g',100,7,A,'weekly',[]],
  ['ginger','Ginger','अदरक','आले','herb','g',100,21,A,'biweekly',[11,12,1]],
  ['garlic','Garlic','लहसुन','लसूण','herb','g',250,30,A,'monthly',[3,4]],
  ['lemon','Lemon','नींबू','लिंबू','herb','pc',6,14,A,'weekly',[6,7,8]],
  // vegetable
  ['tomato','Tomato','टमाटर','टोमॅटो','vegetable','kg',1,5,A,'weekly',[12,1,2]],
  ['brinjal','Brinjal','बैंगन','वांगी','vegetable','g',500,5,A,'biweekly',[11,12,1]],
  ['okra','Okra (bhindi)','भिंडी','भेंडी','vegetable','g',500,3,r(3,10),'weekly',[5,6,7]],
  ['cauliflower','Cauliflower','फूलगोभी','फ्लॉवर','vegetable','pc',1,5,r(10,3),'biweekly',[12,1]],
  ['cabbage','Cabbage','पत्तागोभी','कोबी','vegetable','pc',1,10,r(10,3),'biweekly',[12,1]],
  ['capsicum','Capsicum','शिमला मिर्च','ढोबळी मिरची','vegetable','g',250,7,A,'biweekly',[11,12,1]],
  ['bottle-gourd','Bottle gourd','लौकी','दुधी भोपळा','vegetable','pc',1,7,A,'biweekly',[4,5,6]],
  ['ridge-gourd','Ridge gourd','तोरई','दोडका','vegetable','g',500,4,r(3,10),'biweekly',[6,7,8]],
  ['bitter-gourd','Bitter gourd','करेला','कारले','vegetable','g',250,5,r(3,10),'on_demand',[6,7]],
  ['cucumber','Cucumber','खीरा','काकडी','vegetable','g',500,5,A,'weekly',[3,4,5]],
  ['french-beans','French beans','फ्रेंच बीन्स','फरसबी','vegetable','g',250,4,r(10,4),'biweekly',[12,1,2]],
  ['cluster-beans','Cluster beans','ग्वार फली','गवार','vegetable','g',250,4,r(3,10),'on_demand',[6,7,8]],
  ['green-peas','Green peas','हरी मटर','मटार','vegetable','g',500,4,r(11,3),'weekly',[12,1]],
  ['drumstick','Drumstick','सहजन','शेवगा','vegetable','pc',4,5,r(1,5),'on_demand',[2,3]],
  ['red-pumpkin','Red pumpkin','कद्दू','लाल भोपळा','vegetable','g',500,10,A,'on_demand',[9,10]],
  ['ivy-gourd','Ivy gourd','कुंदरू','तोंडली','vegetable','g',250,4,A,'biweekly',[5,6,7]],
  ['snake-gourd','Snake gourd','चिचिंडा','पडवळ','vegetable','pc',1,4,r(5,10),'on_demand',[7,8]],
  ['flat-beans','Flat beans','सेम','वालपापडी','vegetable','g',250,4,r(11,3),'biweekly',[12,1]],
  ['raw-banana','Raw banana','कच्चा केला','कच्ची केळी','vegetable','pc',2,5,A,'on_demand',[]],
  ['sweet-corn','Sweet corn','मकई','मका','vegetable','pc',2,3,r(6,11),'on_demand',[7,8,9]],
  ['raw-mango','Raw mango','कच्चा आम','कैरी','vegetable','pc',2,7,r(3,6),'on_demand',[4,5]],
  ['long-beans','Long beans','लोबिया फली','चवळीच्या शेंगा','vegetable','g',250,4,r(4,10),'on_demand',[7,8]],
  // root
  ['onion','Onion','प्याज','कांदा','root','kg',2,30,A,'weekly',[]],
  ['potato','Potato','आलू','बटाटा','root','kg',2,30,A,'weekly',[1,2,3]],
  ['carrot','Carrot','गाजर','गाजर','root','g',500,10,A,'weekly',[12,1,2]],
  ['beetroot','Beetroot','चुकंदर','बीट','root','g',500,10,A,'biweekly',[12,1,2]],
  ['radish','Radish','मूली','मुळा','root','pc',2,6,r(10,3),'on_demand',[12,1]],
  ['sweet-potato','Sweet potato','शकरकंद','रताळे','root','g',500,14,r(10,2),'on_demand',[11,12]],
  ['colocasia','Colocasia root','अरबी','अळकुडी','root','g',500,10,r(8,12),'on_demand',[9,10]],
  // fruit
  ['banana','Banana','केला','केळी','fruit','dozen',1,4,A,'weekly',[]],
  ['apple','Apple','सेब','सफरचंद','fruit','kg',1,14,r(8,2),'biweekly',[9,10,11]],
  ['papaya','Papaya','पपीता','पपई','fruit','pc',1,4,A,'biweekly',[]],
  ['pomegranate','Pomegranate','अनार','डाळिंब','fruit','kg',1,14,A,'biweekly',[10,11,12]],
  ['mango','Mango (Alphonso)','आम','आंबा','fruit','dozen',1,5,r(4,6),'weekly',[4,5]],
  ['chikoo','Chikoo','चीकू','चिकू','fruit','g',500,4,r(10,4),'biweekly',[12,1,2]],
  ['guava','Guava','अमरूद','पेरू','fruit','g',500,5,r(8,2),'biweekly',[11,12]],
  ['orange','Orange (Nagpur)','संतरा','संत्री','fruit','kg',1,10,r(11,2),'weekly',[12,1]],
  ['sweet-lime','Sweet lime','मौसंबी','मोसंबी','fruit','kg',1,10,A,'biweekly',[]],
  ['watermelon','Watermelon','तरबूज','कलिंगड','fruit','pc',1,7,r(2,5),'on_demand',[4,5]],
  ['grapes','Grapes','अंगूर','द्राक्षे','fruit','g',500,5,r(1,4),'weekly',[2,3]],
  ['custard-apple','Custard apple','सीताफल','सीताफळ','fruit','pc',4,3,r(8,11),'on_demand',[9,10]],
  ['pineapple','Pineapple','अनानास','अननस','fruit','pc',1,5,r(5,9),'on_demand',[6,7]],
  ['strawberry','Strawberry','स्ट्रॉबेरी','स्ट्रॉबेरी','fruit','g',250,3,r(12,3),'on_demand',[1,2]],
  ['coconut','Coconut','नारियल','नारळ','fruit','pc',1,21,A,'biweekly',[]],
  ['jamun','Jamun','जामुन','जांभूळ','fruit','g',250,2,r(6,7),'on_demand',[6]],
];
const items = rows.map(([id,nameEn,nameHi,nameMr,category,defaultUnit,defaultQty,shelfLifeDays,seasonMonths,rotation,peakMonths]) =>
  ({ id, nameEn, nameHi, nameMr, category, defaultUnit, defaultQty, shelfLifeDays, seasonMonths, rotation, peakMonths }));
if (items.length !== 60) throw new Error('expected 60, got ' + items.length);
if (new Set(items.map(i=>i.id)).size !== 60) throw new Error('dup ids');
writeFileSync(new URL('../functions/src/seed/seedItems.json', import.meta.url), JSON.stringify(items, null, 2) + '\n');
console.log('wrote', items.length);
