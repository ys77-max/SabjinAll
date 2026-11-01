import { DAY_NAMES, type Lang } from './units';

/** Push-notification copy in the household's language. */
export const notifyCopy = {
  draftReady: (lang: Lang, dayIndex: number) => {
    const day = DAY_NAMES[lang][dayIndex];
    return {
      en: { title: 'SabziList', body: `Your list for ${day} is ready — tap to review` },
      hi: { title: 'SabziList', body: `${day} की लिस्ट तैयार है — देखने के लिए टैप करें` },
      mr: { title: 'SabziList', body: `${day} ची यादी तयार आहे — पाहण्यासाठी टॅप करा` },
    }[lang];
  },
  late: (lang: Lang, vendor: string, second: boolean) =>
    ({
      en: {
        title: second ? 'Still no delivery' : 'Delivery late',
        body: `${vendor} hasn't delivered yet — send ${second ? 'another' : 'a'} reminder?`,
      },
      hi: {
        title: second ? 'अभी भी डिलीवरी नहीं' : 'डिलीवरी में देर',
        body: `${vendor} ने अभी तक नहीं भेजा — याद दिलाएं?`,
      },
      mr: {
        title: second ? 'अजूनही भाजी आली नाही' : 'भाजी उशिरा',
        body: `${vendor} यांची भाजी अजून आली नाही — आठवण करून द्यायची?`,
      },
    })[lang],
  deliveryDue: (lang: Lang, vendor: string, time: string) =>
    ({
      en: { title: 'Delivery due', body: `${vendor} is due at ${time}. Tap when it arrives.` },
      hi: { title: 'डिलीवरी आने वाली है', body: `${vendor} ${time} बजे तक आएंगे। आने पर टैप करें।` },
      mr: { title: 'भाजी येणार आहे', body: `${vendor} ${time} पर्यंत येतील. आल्यावर टॅप करा.` },
    })[lang],
  memberAdded: (lang: Lang, who: string, item: string) =>
    ({
      en: { title: 'Added to next order', body: `${who} added ${item}` },
      hi: { title: 'अगले ऑर्डर में जोड़ा', body: `${who} ने ${item} जोड़ा` },
      mr: { title: 'पुढच्या ऑर्डरमध्ये जोडले', body: `${who} यांनी ${item} जोडले` },
    })[lang],
};
