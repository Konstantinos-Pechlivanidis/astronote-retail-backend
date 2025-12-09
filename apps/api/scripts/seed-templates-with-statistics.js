// apps/api/scripts/seed-templates-with-statistics.js
// Comprehensive seed script with statistics and hotels category
// Supports both English and Greek languages
// Templates use: {{first_name}}, {{last_name}}, {{discount_code}}
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const SYSTEM_USER_ID = Number(process.env.SYSTEM_USER_ID || 1);

// Template definitions with statistics - each template has English and Greek versions
const templateDefinitions = [
  // ========== CAFÉ / COFFEE SHOP (7 templates) ==========
  {
    name: 'Welcome New Customer',
    category: 'cafe',
    conversionRate: 28.5,
    productViewsIncrease: 42.0,
    clickThroughRate: 18.3,
    averageOrderValue: 15.2,
    customerRetention: 35.0,
    en: {
      goal: 'Welcome new customers and encourage first visit',
      text: 'Hi {{first_name}}! Welcome to our café! Use code {{discount_code}} for 10% off your first order. Show this message at checkout. Valid until end of month.',
      suggestedMetrics: 'Conversion rate, first visit rate'
    },
    gr: {
      goal: 'Καλώς ήρθατε νέοι πελάτες και ενθάρρυνση πρώτης επίσκεψης',
      text: 'Γεια σου {{first_name}}! Καλώς ήρθες στο καφέ μας! Χρησιμοποίησε τον κωδικό {{discount_code}} για 10% έκπτωση στην πρώτη σου παραγγελία. Δείξε αυτό το μήνυμα στο ταμείο. Ισχύει μέχρι τέλος μήνα.',
      suggestedMetrics: 'Ποσοστό μετατροπής, ποσοστό πρώτης επίσκεψης'
    }
  },
  {
    name: 'Happy Hour Promotion',
    category: 'cafe',
    conversionRate: 32.0,
    productViewsIncrease: 48.5,
    clickThroughRate: 22.1,
    averageOrderValue: 18.7,
    customerRetention: 28.5,
    en: {
      goal: 'Drive foot traffic during off-peak hours',
      text: 'Hey {{first_name}}! Happy Hour is on! 2-for-1 on all drinks from 2-4 PM today. Use code {{discount_code}} for extra savings. See you soon!',
      suggestedMetrics: 'Visit frequency, redemption rate, off-peak traffic'
    },
    gr: {
      goal: 'Αύξηση επισκεψιμότητας κατά τις ώρες χαμηλής κίνησης',
      text: 'Γεια σου {{first_name}}! Happy Hour σε εξέλιξη! 2-για-1 σε όλα τα ποτά από 2-4μμ σήμερα. Χρησιμοποίησε τον κωδικό {{discount_code}} για επιπλέον εξοικονόμηση. Τα λέμε σύντομα!',
      suggestedMetrics: 'Συχνότητα επισκέψεων, ποσοστό εξαργύρωσης, κίνηση εκτός αιχμής'
    }
  },
  {
    name: 'Loyalty Reward Reminder',
    category: 'cafe',
    conversionRate: 38.7,
    productViewsIncrease: 35.2,
    clickThroughRate: 24.5,
    averageOrderValue: 31.6,
    customerRetention: 45.0,
    en: {
      goal: 'Encourage repeat visits and loyalty program engagement',
      text: 'Hi {{first_name}}, you\'re just 2 visits away from a free coffee! Use {{discount_code}} for 15% off this week. Come in to claim your reward.',
      suggestedMetrics: 'Repeat visit rate, loyalty program engagement'
    },
    gr: {
      goal: 'Ενθάρρυνση επαναλαμβανόμενων επισκέψεων και συμμετοχής στο πρόγραμμα αφοσίωσης',
      text: 'Γεια σου {{first_name}}, απέχεις μόνο 2 επισκέψεις από ένα δωρεάν καφέ! Χρησιμοποίησε τον {{discount_code}} για 15% έκπτωση αυτή την εβδομάδα. Έλα για να διεκδικήσεις την ανταμοιβή σου.',
      suggestedMetrics: 'Ποσοστό επαναλαμβανόμενων επισκέψεων, συμμετοχή στο πρόγραμμα αφοσίωσης'
    }
  },
  {
    name: 'New Menu Item Launch',
    category: 'cafe',
    conversionRate: 26.8,
    productViewsIncrease: 45.3,
    clickThroughRate: 19.6,
    averageOrderValue: 16.9,
    customerRetention: 30.0,
    en: {
      goal: 'Promote new products and increase average order value',
      text: '{{first_name}}, we\'ve got something new! Try our seasonal special. Use {{discount_code}} for 10% off. Ask about it on your next visit. Limited time only!',
      suggestedMetrics: 'Average order value, new product adoption rate'
    },
    gr: {
      goal: 'Προώθηση νέων προϊόντων και αύξηση μέσης αξίας παραγγελίας',
      text: '{{first_name}}, έχουμε κάτι καινούργιο! Δοκίμασε την εποχιακή μας προσφορά. Χρησιμοποίησε τον {{discount_code}} για 10% έκπτωση. Ρώτησε για αυτή στην επόμενη επίσκεψή σου. Περιορισμένος χρόνος!',
      suggestedMetrics: 'Μέση αξία παραγγελίας, ποσοστό υιοθέτησης νέων προϊόντων'
    }
  },
  {
    name: 'Win-back Inactive Customers',
    category: 'cafe',
    conversionRate: 22.4,
    productViewsIncrease: 30.8,
    clickThroughRate: 15.3,
    averageOrderValue: 14.2,
    customerRetention: 18.0,
    en: {
      goal: 'Re-engage customers who haven\'t visited recently',
      text: 'We miss you, {{first_name}}! Come back and enjoy 15% off with code {{discount_code}}. Valid this week only.',
      suggestedMetrics: 'Win-back rate, reactivation rate'
    },
    gr: {
      goal: 'Επανενεργοποίηση πελατών που δεν έχουν επισκεφθεί πρόσφατα',
      text: 'Σε λείπουν, {{first_name}}! Έλα πίσω και απόλαυσε 15% έκπτωση με τον κωδικό {{discount_code}}. Ισχύει μόνο αυτή την εβδομάδα.',
      suggestedMetrics: 'Ποσοστό επανενεργοποίησης, ποσοστό ανάκτησης'
    }
  },
  {
    name: 'Special Event Announcement',
    category: 'cafe',
    conversionRate: 24.8,
    productViewsIncrease: 36.2,
    clickThroughRate: 17.9,
    averageOrderValue: 15.4,
    customerRetention: 28.0,
    en: {
      goal: 'Promote special events and increase foot traffic',
      text: 'Hi {{first_name}}! Join us this Saturday for our live music night. Use {{discount_code}} for 10% off. Free entry, great atmosphere! See you there!',
      suggestedMetrics: 'Event attendance, foot traffic, customer engagement'
    },
    gr: {
      goal: 'Προώθηση ειδικών εκδηλώσεων και αύξηση επισκεψιμότητας',
      text: 'Γεια σου {{first_name}}! Ελάτε μαζί μας το Σάββατο για τη μουσική βραδιά μας. Χρησιμοποίησε τον {{discount_code}} για 10% έκπτωση. Δωρεάν είσοδος, υπέροχη ατμόσφαιρα! Τα λέμε εκεί!',
      suggestedMetrics: 'Συμμετοχή σε εκδηλώσεις, επισκεψιμότητα, συμμετοχή πελατών'
    }
  },
  {
    name: 'Seasonal Promotion',
    category: 'cafe',
    conversionRate: 29.3,
    productViewsIncrease: 40.1,
    clickThroughRate: 21.2,
    averageOrderValue: 17.8,
    customerRetention: 25.0,
    en: {
      goal: 'Promote seasonal offers and drive sales',
      text: '{{first_name}}, our autumn special is here! Try our pumpkin spice latte. Use {{discount_code}} for 15% off. Limited time offer!',
      suggestedMetrics: 'Seasonal sales, average order value, customer visits'
    },
    gr: {
      goal: 'Προώθηση εποχιακών προσφορών και αύξηση πωλήσεων',
      text: '{{first_name}}, η φθινοπωρινή μας προσφορά είναι εδώ! Δοκίμασε το pumpkin spice latte μας. Χρησιμοποίησε τον {{discount_code}} για 15% έκπτωση. Προσφορά περιορισμένου χρόνου!',
      suggestedMetrics: 'Εποχιακές πωλήσεις, μέση αξία παραγγελίας, επισκέψεις πελατών'
    }
  },

  // ========== RESTAURANT / FOOD (7 templates) ==========
  {
    name: 'Weekend Special Offer',
    category: 'restaurant',
    conversionRate: 31.2,
    productViewsIncrease: 52.4,
    clickThroughRate: 23.8,
    averageOrderValue: 20.1,
    customerRetention: 22.0,
    en: {
      goal: 'Increase weekend bookings and revenue',
      text: 'Hi {{first_name}}! This weekend, enjoy our special 3-course menu for just €25. Use code {{discount_code}} for extra 10% off. Book your table now!',
      suggestedMetrics: 'Booking rate, weekend revenue, average spend'
    },
    gr: {
      goal: 'Αύξηση κρατήσεων και εσόδων για το σαββατοκύριακο',
      text: 'Γεια σου {{first_name}}! Αυτό το σαββατοκύριακο, απολαύστε το ειδικό μας μενού 3 πιάτων για μόνο €25. Χρησιμοποίησε τον κωδικό {{discount_code}} για επιπλέον 10% έκπτωση. Κάντε κράτηση τώρα!',
      suggestedMetrics: 'Ποσοστό κρατήσεων, έσοδα σαββατοκύριακου, μέση δαπάνη'
    }
  },
  {
    name: 'Birthday Special',
    category: 'restaurant',
    conversionRate: 36.9,
    productViewsIncrease: 33.5,
    clickThroughRate: 27.1,
    averageOrderValue: 26.3,
    customerRetention: 40.0,
    en: {
      goal: 'Celebrate customer birthdays and drive visits',
      text: 'Happy Birthday {{first_name}}! Celebrate with us - enjoy a complimentary dessert with any main course. Use {{discount_code}} for 20% off this month.',
      suggestedMetrics: 'Birthday visit rate, customer satisfaction'
    },
    gr: {
      goal: 'Γιορτάστε τα γενέθλια των πελατών και αυξήστε τις επισκέψεις',
      text: 'Χρόνια Πολλά {{first_name}}! Γιόρτασε μαζί μας - απολαύστε ένα δωρεάν επιδόρπιο με οποιοδήποτε κυρίως πιάτο. Χρησιμοποίησε τον {{discount_code}} για 20% έκπτωση αυτόν τον μήνα.',
      suggestedMetrics: 'Ποσοστό επισκέψεων γενεθλίων, ικανοποίηση πελατών'
    }
  },
  {
    name: 'Lunch Deal Promotion',
    category: 'restaurant',
    conversionRate: 27.6,
    productViewsIncrease: 41.3,
    clickThroughRate: 20.4,
    averageOrderValue: 19.8,
    customerRetention: 32.0,
    en: {
      goal: 'Drive lunch traffic and increase midday revenue',
      text: '{{first_name}}, our lunch special is back! €12 for main + drink, Mon-Fri 12-3 PM. Use {{discount_code}} for extra 5% off. Book your table!',
      suggestedMetrics: 'Lunch traffic, weekday revenue'
    },
    gr: {
      goal: 'Αύξηση κίνησης μεσημεριανών και εσόδων μεσημέρι',
      text: '{{first_name}}, η μεσημεριανή μας προσφορά επέστρεψε! €12 για κυρίως πιάτο + ποτό, Δευ-Παρ 12-3μμ. Χρησιμοποίησε τον {{discount_code}} για επιπλέον 5% έκπτωση. Κάντε κράτηση!',
      suggestedMetrics: 'Κίνηση μεσημεριανών, έσοδα εβδομάδας'
    }
  },
  {
    name: 'Event Announcement',
    category: 'restaurant',
    conversionRate: 24.8,
    productViewsIncrease: 36.2,
    clickThroughRate: 17.9,
    averageOrderValue: 15.4,
    customerRetention: 28.0,
    en: {
      goal: 'Promote special events and increase bookings',
      text: 'Hi {{first_name}}! Join us this Friday for live music and special menu. Use {{discount_code}} for 15% off. Limited tables - reserve now!',
      suggestedMetrics: 'Event attendance, booking rate'
    },
    gr: {
      goal: 'Προώθηση ειδικών εκδηλώσεων και αύξηση κρατήσεων',
      text: 'Γεια σου {{first_name}}! Ελάτε μαζί μας την Παρασκευή για ζωντανή μουσική και ειδικό μενού. Χρησιμοποίησε τον {{discount_code}} για 15% έκπτωση. Περιορισμένοι πίνακες - κάντε κράτηση τώρα!',
      suggestedMetrics: 'Συμμετοχή σε εκδηλώσεις, ποσοστό κρατήσεων'
    }
  },
  {
    name: 'Loyalty Program Update',
    category: 'restaurant',
    conversionRate: 38.7,
    productViewsIncrease: 35.2,
    clickThroughRate: 24.5,
    averageOrderValue: 31.6,
    customerRetention: 45.0,
    en: {
      goal: 'Encourage repeat visits and loyalty program sign-ups',
      text: '{{first_name}}, join our loyalty program! Earn points with every visit. Use {{discount_code}} for 10% off your next meal. Your next meal could be on us!',
      suggestedMetrics: 'Loyalty sign-up rate, repeat visit frequency'
    },
    gr: {
      goal: 'Ενθάρρυνση επαναλαμβανόμενων επισκέψεων και εγγραφών στο πρόγραμμα αφοσίωσης',
      text: '{{first_name}}, εγγράψου στο πρόγραμμα αφοσίωσης μας! Κέρδισε πόντους με κάθε επίσκεψη. Χρησιμοποίησε τον {{discount_code}} για 10% έκπτωση στο επόμενο γεύμα σου. Το επόμενο γεύμα σου μπορεί να είναι δικό μας!',
      suggestedMetrics: 'Ποσοστό εγγραφών στο πρόγραμμα αφοσίωσης, συχνότητα επαναλαμβανόμενων επισκέψεων'
    }
  },
  {
    name: 'New Menu Launch',
    category: 'restaurant',
    conversionRate: 30.5,
    productViewsIncrease: 43.7,
    clickThroughRate: 22.8,
    averageOrderValue: 18.3,
    customerRetention: 24.0,
    en: {
      goal: 'Promote new menu items and increase visits',
      text: '{{first_name}}, we\'ve updated our menu! Try our new dishes. Use {{discount_code}} for 15% off your first order from the new menu.',
      suggestedMetrics: 'New menu adoption, visit frequency, average order value'
    },
    gr: {
      goal: 'Προώθηση νέων στοιχείων μενού και αύξηση επισκέψεων',
      text: '{{first_name}}, ανανεώσαμε το μενού μας! Δοκίμασε τα νέα μας πιάτα. Χρησιμοποίησε τον {{discount_code}} για 15% έκπτωση στην πρώτη παραγγελία από το νέο μενού.',
      suggestedMetrics: 'Υιοθέτηση νέου μενού, συχνότητα επισκέψεων, μέση αξία παραγγελίας'
    }
  },
  {
    name: 'Holiday Special',
    category: 'restaurant',
    conversionRate: 42.5,
    productViewsIncrease: 68.0,
    clickThroughRate: 35.2,
    averageOrderValue: 34.7,
    customerRetention: 20.0,
    en: {
      goal: 'Promote holiday specials and increase bookings',
      text: 'Hi {{first_name}}! Celebrate the holidays with us. Special festive menu available all December. Use {{discount_code}} for 20% off. Book your table today!',
      suggestedMetrics: 'Holiday bookings, seasonal revenue, customer engagement'
    },
    gr: {
      goal: 'Προώθηση ειδικών προσφορών αργιών και αύξηση κρατήσεων',
      text: 'Γεια σου {{first_name}}! Γιόρτασε τις γιορτές μαζί μας. Ειδικό εορταστικό μενού διαθέσιμο όλο τον Δεκέμβριο. Χρησιμοποίησε τον {{discount_code}} για 20% έκπτωση. Κάντε κράτηση σήμερα!',
      suggestedMetrics: 'Κρατήσεις αργιών, εποχιακά έσοδα, συμμετοχή πελατών'
    }
  },

  // ========== GYM / FITNESS (7 templates) ==========
  {
    name: 'New Member Welcome',
    category: 'gym',
    conversionRate: 28.5,
    productViewsIncrease: 42.0,
    clickThroughRate: 18.3,
    averageOrderValue: 15.2,
    customerRetention: 35.0,
    en: {
      goal: 'Welcome new members and encourage first visit',
      text: 'Welcome {{first_name}}! Your membership is active. Book your free orientation session this week. Use {{discount_code}} for 10% off personal training. Let\'s get started!',
      suggestedMetrics: 'First visit rate, orientation attendance'
    },
    gr: {
      goal: 'Καλώς ήρθατε νέα μέλη και ενθάρρυνση πρώτης επίσκεψης',
      text: 'Καλώς ήρθες {{first_name}}! Η συνδρομή σου είναι ενεργή. Κλείσε την δωρεάν συνεδρία προσανατολισμού σου αυτή την εβδομάδα. Χρησιμοποίησε τον {{discount_code}} για 10% έκπτωση στην προσωπική προπόνηση. Ας ξεκινήσουμε!',
      suggestedMetrics: 'Ποσοστό πρώτης επίσκεψης, συμμετοχή σε προσανατολισμό'
    }
  },
  {
    name: 'Class Reminder',
    category: 'gym',
    conversionRate: 26.8,
    productViewsIncrease: 38.5,
    clickThroughRate: 19.6,
    averageOrderValue: 16.9,
    customerRetention: 30.0,
    en: {
      goal: 'Reduce no-shows and increase class attendance',
      text: 'Hi {{first_name}}! Reminder: Your class is tomorrow at 6 PM. See you there!',
      suggestedMetrics: 'Class attendance rate, no-show reduction'
    },
    gr: {
      goal: 'Μείωση απουσιών και αύξηση συμμετοχής σε μαθήματα',
      text: 'Γεια σου {{first_name}}! Υπενθύμιση: Το μάθημά σου είναι αύριο στις 6μμ. Τα λέμε εκεί!',
      suggestedMetrics: 'Ποσοστό συμμετοχής σε μαθήματα, μείωση απουσιών'
    }
  },
  {
    name: 'Win-back Inactive Members',
    category: 'gym',
    conversionRate: 21.7,
    productViewsIncrease: 28.5,
    clickThroughRate: 14.2,
    averageOrderValue: 13.6,
    customerRetention: 16.0,
    en: {
      goal: 'Re-engage members who haven\'t visited recently',
      text: 'We miss you {{first_name}}! Your membership is still active. Come back this week and get a free personal training session. Use {{discount_code}} for 20% off monthly plan.',
      suggestedMetrics: 'Member reactivation rate, retention rate'
    },
    gr: {
      goal: 'Επανενεργοποίηση μελών που δεν έχουν επισκεφθεί πρόσφατα',
      text: 'Σε λείπουν {{first_name}}! Η συνδρομή σου είναι ακόμα ενεργή. Έλα πίσω αυτή την εβδομάδα και πάρε μια δωρεάν προσωπική προπόνηση. Χρησιμοποίησε τον {{discount_code}} για 20% έκπτωση στο μηνιαίο πακέτο.',
      suggestedMetrics: 'Ποσοστό επανενεργοποίησης μελών, ποσοστό διατήρησης'
    }
  },
  {
    name: 'New Class Launch',
    category: 'gym',
    conversionRate: 27.6,
    productViewsIncrease: 41.3,
    clickThroughRate: 20.4,
    averageOrderValue: 19.8,
    customerRetention: 32.0,
    en: {
      goal: 'Promote new classes and increase participation',
      text: '{{first_name}}, we\'re launching a new class! First session is free for all members. Use {{discount_code}} for 15% off class packages. Book your spot!',
      suggestedMetrics: 'New class adoption, class attendance'
    },
    gr: {
      goal: 'Προώθηση νέων μαθημάτων και αύξηση συμμετοχής',
      text: '{{first_name}}, ξεκινάμε ένα νέο μάθημα! Η πρώτη συνεδρία είναι δωρεάν για όλα τα μέλη. Χρησιμοποίησε τον {{discount_code}} για 15% έκπτωση στα πακέτα μαθημάτων. Κλείσε τη θέση σου!',
      suggestedMetrics: 'Υιοθέτηση νέου μαθήματος, συμμετοχή σε μαθήματα'
    }
  },
  {
    name: 'Achievement Celebration',
    category: 'gym',
    conversionRate: 36.9,
    productViewsIncrease: 33.5,
    clickThroughRate: 27.1,
    averageOrderValue: 26.3,
    customerRetention: 40.0,
    en: {
      goal: 'Celebrate member milestones and build community',
      text: 'Congratulations {{first_name}}! You\'ve hit an amazing milestone. Use {{discount_code}} for 10% off your next package. Keep up the great work - you\'re inspiring others!',
      suggestedMetrics: 'Member engagement, community building'
    },
    gr: {
      goal: 'Γιορτάστε τα ορόσημα των μελών και δημιουργία κοινότητας',
      text: 'Συγχαρητήρια {{first_name}}! Έφτασες ένα καταπληκτικό ορόσημο. Χρησιμοποίησε τον {{discount_code}} για 10% έκπτωση στο επόμενο πακέτο σου. Συνέχισε την εξαιρετική δουλειά - εμπνέεις άλλους!',
      suggestedMetrics: 'Συμμετοχή μελών, δημιουργία κοινότητας'
    }
  },
  {
    name: 'Personal Training Offer',
    category: 'gym',
    conversionRate: 34.1,
    productViewsIncrease: 58.7,
    clickThroughRate: 26.3,
    averageOrderValue: 24.5,
    customerRetention: 26.0,
    en: {
      goal: 'Promote personal training services and increase revenue',
      text: 'Hi {{first_name}}! Ready to take your fitness to the next level? Book a personal training session. Use {{discount_code}} for 20% off your first package.',
      suggestedMetrics: 'Personal training bookings, revenue per member, member satisfaction'
    },
    gr: {
      goal: 'Προώθηση υπηρεσιών προσωπικής προπόνησης και αύξηση εσόδων',
      text: 'Γεια σου {{first_name}}! Έτοιμος να πάς τη φυσική σου κατάσταση στο επόμενο επίπεδο; Κλείσε μια προσωπική προπόνηση. Χρησιμοποίησε τον {{discount_code}} για 20% έκπτωση στο πρώτο πακέτο σου.',
      suggestedMetrics: 'Κρατήσεις προσωπικής προπόνησης, έσοδα ανά μέλος, ικανοποίηση μελών'
    }
  },
  {
    name: 'Equipment Update',
    category: 'gym',
    conversionRate: 24.8,
    productViewsIncrease: 36.2,
    clickThroughRate: 17.9,
    averageOrderValue: 15.4,
    customerRetention: 28.0,
    en: {
      goal: 'Announce new equipment and encourage visits',
      text: '{{first_name}}, we\'ve upgraded our equipment! Come try our new machines. Use {{discount_code}} for 10% off day passes. See you at the gym!',
      suggestedMetrics: 'Visit frequency, equipment usage, member satisfaction'
    },
    gr: {
      goal: 'Ανακοίνωση νέου εξοπλισμού και ενθάρρυνση επισκέψεων',
      text: '{{first_name}}, αναβαθμίσαμε τον εξοπλισμό μας! Έλα δοκίμασε τις νέες μας μηχανές. Χρησιμοποίησε τον {{discount_code}} για 10% έκπτωση στα ημερήσια εισιτήρια. Τα λέμε στο γυμναστήριο!',
      suggestedMetrics: 'Συχνότητα επισκέψεων, χρήση εξοπλισμού, ικανοποίηση μελών'
    }
  },

  // ========== SPORTS CLUB / TEAM (7 templates) ==========
  {
    name: 'Match Reminder',
    category: 'sports_club',
    conversionRate: 26.8,
    productViewsIncrease: 38.5,
    clickThroughRate: 19.6,
    averageOrderValue: 16.9,
    customerRetention: 30.0,
    en: {
      goal: 'Ensure team attendance and reduce no-shows',
      text: 'Hi {{first_name}}, match reminder this week! Check the schedule for details. See you there!',
      suggestedMetrics: 'Attendance rate, no-show reduction'
    },
    gr: {
      goal: 'Εξασφάλιση συμμετοχής ομάδας και μείωση απουσιών',
      text: 'Γεια σου {{first_name}}, υπενθύμιση αγώνα αυτή την εβδομάδα! Ελέγξτε το πρόγραμμα για λεπτομέρειες. Τα λέμε εκεί!',
      suggestedMetrics: 'Ποσοστό συμμετοχής, μείωση απουσιών'
    }
  },
  {
    name: 'Training Session Update',
    category: 'sports_club',
    conversionRate: 24.8,
    productViewsIncrease: 36.2,
    clickThroughRate: 17.9,
    averageOrderValue: 15.4,
    customerRetention: 28.0,
    en: {
      goal: 'Keep members informed about schedule changes',
      text: '{{first_name}}, training update: This week\'s session schedule has changed. Please check the updated times. See you there!',
      suggestedMetrics: 'Attendance rate, communication effectiveness'
    },
    gr: {
      goal: 'Ενημέρωση μελών για αλλαγές προγράμματος',
      text: '{{first_name}}, ενημέρωση προπόνησης: Το πρόγραμμα συνεδριών αυτής της εβδομάδας έχει αλλάξει. Παρακαλώ ελέγξτε τις ενημερωμένες ώρες. Τα λέμε εκεί!',
      suggestedMetrics: 'Ποσοστό συμμετοχής, αποτελεσματικότητα επικοινωνίας'
    }
  },
  {
    name: 'Team Event Announcement',
    category: 'sports_club',
    conversionRate: 30.5,
    productViewsIncrease: 43.7,
    clickThroughRate: 22.8,
    averageOrderValue: 18.3,
    customerRetention: 24.0,
    en: {
      goal: 'Promote team events and build community',
      text: 'Hi {{first_name}}! Team event coming up soon. Use {{discount_code}} for 10% off event tickets. All members welcome. Check details and RSVP!',
      suggestedMetrics: 'Event attendance, member engagement'
    },
    gr: {
      goal: 'Προώθηση εκδηλώσεων ομάδας και δημιουργία κοινότητας',
      text: 'Γεια σου {{first_name}}! Εκδήλωση ομάδας έρχεται σύντομα. Χρησιμοποίησε τον {{discount_code}} για 10% έκπτωση στα εισιτήρια εκδήλωσης. Όλα τα μέλη είναι ευπρόσδεκτα. Ελέγξτε λεπτομέρειες και επιβεβαιώστε!',
      suggestedMetrics: 'Συμμετοχή σε εκδηλώσεις, συμμετοχή μελών'
    }
  },
  {
    name: 'New Member Welcome',
    category: 'sports_club',
    conversionRate: 28.5,
    productViewsIncrease: 42.0,
    clickThroughRate: 18.3,
    averageOrderValue: 15.2,
    customerRetention: 35.0,
    en: {
      goal: 'Welcome new team members and encourage participation',
      text: 'Welcome to the team {{first_name}}! Your first training session details have been sent. Use {{discount_code}} for 15% off membership. Looking forward to meeting you!',
      suggestedMetrics: 'First session attendance, member retention'
    },
    gr: {
      goal: 'Καλώς ήρθατε νέα μέλη ομάδας και ενθάρρυνση συμμετοχής',
      text: 'Καλώς ήρθες στην ομάδα {{first_name}}! Οι λεπτομέρειες της πρώτης προπόνησης σου έχουν σταλεί. Χρησιμοποίησε τον {{discount_code}} για 15% έκπτωση στη συνδρομή. Ανυπομονούμε να σε γνωρίσουμε!',
      suggestedMetrics: 'Συμμετοχή πρώτης συνεδρίας, διατήρηση μελών'
    }
  },
  {
    name: 'Achievement Recognition',
    category: 'sports_club',
    conversionRate: 36.9,
    productViewsIncrease: 33.5,
    clickThroughRate: 27.1,
    averageOrderValue: 26.3,
    customerRetention: 40.0,
    en: {
      goal: 'Celebrate team achievements and boost morale',
      text: 'Amazing work {{first_name}}! Your dedication is making a difference. Use {{discount_code}} for 10% off next season. Keep it up - the team is proud!',
      suggestedMetrics: 'Member engagement, team morale'
    },
    gr: {
      goal: 'Γιορτάστε τα επιτεύγματα της ομάδας και ενίσχυση ηθικού',
      text: 'Εξαιρετική δουλειά {{first_name}}! Η αφοσίωσή σου κάνει τη διαφορά. Χρησιμοποίησε τον {{discount_code}} για 10% έκπτωση στην επόμενη σεζόν. Συνέχισε - η ομάδα είναι περήφανη!',
      suggestedMetrics: 'Συμμετοχή μελών, ηθικό ομάδας'
    }
  },
  {
    name: 'Tournament Announcement',
    category: 'sports_club',
    conversionRate: 39.4,
    productViewsIncrease: 64.8,
    clickThroughRate: 30.6,
    averageOrderValue: 29.2,
    customerRetention: 35.0,
    en: {
      goal: 'Promote tournaments and increase participation',
      text: '{{first_name}}, tournament registration is open! Join us for the upcoming championship. Use {{discount_code}} for 15% off registration. Limited spots available!',
      suggestedMetrics: 'Tournament participation, member engagement, event revenue'
    },
    gr: {
      goal: 'Προώθηση τουρνουά και αύξηση συμμετοχής',
      text: '{{first_name}}, οι εγγραφές τουρνουά είναι ανοιχτές! Ελάτε μαζί μας για το επερχόμενο πρωτάθλημα. Χρησιμοποίησε τον {{discount_code}} για 15% έκπτωση στην εγγραφή. Περιορισμένες θέσεις διαθέσιμες!',
      suggestedMetrics: 'Συμμετοχή σε τουρνουά, συμμετοχή μελών, έσοδα εκδήλωσης'
    }
  },
  {
    name: 'Seasonal Training Camp',
    category: 'sports_club',
    conversionRate: 31.2,
    productViewsIncrease: 52.4,
    clickThroughRate: 23.8,
    averageOrderValue: 20.1,
    customerRetention: 22.0,
    en: {
      goal: 'Promote training camps and increase member engagement',
      text: 'Hi {{first_name}}! Our summer training camp is starting soon. Use {{discount_code}} for 20% off camp fees. Book your spot today!',
      suggestedMetrics: 'Camp participation, member engagement, seasonal revenue'
    },
    gr: {
      goal: 'Προώθηση προπονητικών καμπ και αύξηση συμμετοχής μελών',
      text: 'Γεια σου {{first_name}}! Το καλοκαιρινό προπονητικό μας στρατόπεδο ξεκινά σύντομα. Χρησιμοποίησε τον {{discount_code}} για 20% έκπτωση στα τέλη στρατοπέδου. Κλείσε τη θέση σου σήμερα!',
      suggestedMetrics: 'Συμμετοχή σε στρατόπεδο, συμμετοχή μελών, εποχιακά έσοδα'
    }
  },

  // ========== GENERIC / ANY BUSINESS (7 templates) ==========
  {
    name: 'Flash Sale Alert',
    category: 'generic',
    conversionRate: 40.2,
    productViewsIncrease: 62.5,
    clickThroughRate: 32.8,
    averageOrderValue: 28.4,
    customerRetention: 15.0,
    en: {
      goal: 'Drive immediate sales with time-limited offers',
      text: '{{first_name}}, flash sale! 20% off everything today only. Use code {{discount_code}} at checkout. Don\'t miss out!',
      suggestedMetrics: 'Conversion rate, sales volume, urgency response'
    },
    gr: {
      goal: 'Αύξηση άμεσων πωλήσεων με προσφορές περιορισμένου χρόνου',
      text: '{{first_name}}, flash sale! 20% έκπτωση σε όλα μόνο σήμερα. Χρησιμοποίησε τον κωδικό {{discount_code}} στο ταμείο. Μην το χάσεις!',
      suggestedMetrics: 'Ποσοστό μετατροπής, όγκος πωλήσεων, απόκριση επείγοντος'
    }
  },
  {
    name: 'Seasonal Promotion',
    category: 'generic',
    conversionRate: 31.2,
    productViewsIncrease: 52.4,
    clickThroughRate: 23.8,
    averageOrderValue: 20.1,
    customerRetention: 22.0,
    en: {
      goal: 'Promote seasonal offers and increase sales',
      text: 'Hi {{first_name}}! Our seasonal special is here. Enjoy exclusive deals all month long. Use {{discount_code}} for 15% off. Visit us soon!',
      suggestedMetrics: 'Seasonal sales, visit frequency'
    },
    gr: {
      goal: 'Προώθηση εποχιακών προσφορών και αύξηση πωλήσεων',
      text: 'Γεια σου {{first_name}}! Η εποχιακή μας προσφορά είναι εδώ. Απολαύστε αποκλειστικές προσφορές όλο τον μήνα. Χρησιμοποίησε τον {{discount_code}} για 15% έκπτωση. Επισκέψου μας σύντομα!',
      suggestedMetrics: 'Εποχιακές πωλήσεις, συχνότητα επισκέψεων'
    }
  },
  {
    name: 'Customer Feedback Request',
    category: 'generic',
    conversionRate: 24.8,
    productViewsIncrease: 36.2,
    clickThroughRate: 17.9,
    averageOrderValue: 15.4,
    customerRetention: 28.0,
    en: {
      goal: 'Gather feedback and improve customer experience',
      text: 'Hi {{first_name}}, we\'d love your feedback! Share your experience and get 10% off your next visit with code {{discount_code}}. Thank you!',
      suggestedMetrics: 'Feedback response rate, customer satisfaction'
    },
    gr: {
      goal: 'Συλλογή σχολίων και βελτίωση εμπειρίας πελατών',
      text: 'Γεια σου {{first_name}}, θα θέλαμε τα σχόλιά σου! Μοιράσου την εμπειρία σου και πάρε 10% έκπτωση στην επόμενη επίσκεψή σου με τον κωδικό {{discount_code}}. Ευχαριστούμε!',
      suggestedMetrics: 'Ποσοστό απόκρισης σχολίων, ικανοποίηση πελατών'
    }
  },
  {
    name: 'Referral Program',
    category: 'generic',
    conversionRate: 30.5,
    productViewsIncrease: 43.7,
    clickThroughRate: 22.8,
    averageOrderValue: 18.3,
    customerRetention: 24.0,
    en: {
      goal: 'Encourage referrals and grow customer base',
      text: '{{first_name}}, refer a friend and you both get a special reward! Use code {{discount_code}} for 15% off. Contact us for your unique referral code.',
      suggestedMetrics: 'Referral rate, new customer acquisition'
    },
    gr: {
      goal: 'Ενθάρρυνση παραπομπών και ανάπτυξη βάσης πελατών',
      text: '{{first_name}}, συνέστησε έναν φίλο και και οι δύο παίρνετε μια ειδική ανταμοιβή! Χρησιμοποίησε τον κωδικό {{discount_code}} για 15% έκπτωση. Επικοινώνησε μαζί μας για τον μοναδικό σου κωδικό παραπομπής.',
      suggestedMetrics: 'Ποσοστό παραπομπών, απόκτηση νέων πελατών'
    }
  },
  {
    name: 'Thank You Message',
    category: 'generic',
    conversionRate: 36.9,
    productViewsIncrease: 33.5,
    clickThroughRate: 27.1,
    averageOrderValue: 26.3,
    customerRetention: 40.0,
    en: {
      goal: 'Show appreciation and encourage repeat business',
      text: 'Thank you {{first_name}} {{last_name}} for being a valued customer! We appreciate your support. Use {{discount_code}} for 10% off your next visit. See you again soon!',
      suggestedMetrics: 'Customer retention, loyalty metrics'
    },
    gr: {
      goal: 'Εμφάνιση εκτίμησης και ενθάρρυνση επαναλαμβανόμενης επιχείρησης',
      text: 'Ευχαριστούμε {{first_name}} {{last_name}} που είσαι πολύτιμος πελάτης! Εκτιμούμε την υποστήριξή σου. Χρησιμοποίησε τον {{discount_code}} για 10% έκπτωση στην επόμενη επίσκεψή σου. Τα ξαναλέμε σύντομα!',
      suggestedMetrics: 'Διατήρηση πελατών, μετρικές αφοσίωσης'
    }
  },
  {
    name: 'New Product Launch',
    category: 'generic',
    conversionRate: 27.6,
    productViewsIncrease: 41.3,
    clickThroughRate: 20.4,
    averageOrderValue: 19.8,
    customerRetention: 32.0,
    en: {
      goal: 'Promote new products and drive sales',
      text: '{{first_name}}, we\'ve launched something exciting! Check out our new products. Use {{discount_code}} for 15% off new items. Limited time offer!',
      suggestedMetrics: 'New product adoption, sales volume, customer engagement'
    },
    gr: {
      goal: 'Προώθηση νέων προϊόντων και αύξηση πωλήσεων',
      text: '{{first_name}}, κυκλοφορήσαμε κάτι συναρπαστικό! Δες τα νέα μας προϊόντα. Χρησιμοποίησε τον {{discount_code}} για 15% έκπτωση σε νέα προϊόντα. Προσφορά περιορισμένου χρόνου!',
      suggestedMetrics: 'Υιοθέτηση νέων προϊόντων, όγκος πωλήσεων, συμμετοχή πελατών'
    }
  },
  {
    name: 'Special Offer for You',
    category: 'generic',
    conversionRate: 30.5,
    productViewsIncrease: 43.7,
    clickThroughRate: 22.8,
    averageOrderValue: 18.3,
    customerRetention: 24.0,
    en: {
      goal: 'Personalized offer to drive engagement',
      text: '{{first_name}}, we have a special offer just for you! Use {{discount_code}} for 20% off. Don\'t miss out!',
      suggestedMetrics: 'Personalized offer conversion, customer engagement'
    },
    gr: {
      goal: 'Προσωποποιημένη προσφορά για αύξηση συμμετοχής',
      text: '{{first_name}}, έχουμε μια ειδική προσφορά μόνο για εσένα! Χρησιμοποίησε τον {{discount_code}} για 20% έκπτωση. Μην το χάσεις!',
      suggestedMetrics: 'Μετατροπή προσωποποιημένης προσφοράς, συμμετοχή πελατών'
    }
  },

  // ========== HOTELS (7 templates) ==========
  {
    name: 'Welcome New Guest',
    category: 'hotels',
    conversionRate: 32.0,
    productViewsIncrease: 48.5,
    clickThroughRate: 22.1,
    averageOrderValue: 18.7,
    customerRetention: 28.5,
    en: {
      goal: 'Welcome new guests and encourage bookings',
      text: 'Hi {{first_name}}! Welcome to our hotel! Book your stay and use code {{discount_code}} for 15% off. We look forward to hosting you!',
      suggestedMetrics: 'Booking rate, first-time guest conversion'
    },
    gr: {
      goal: 'Καλώς ήρθατε νέοι επισκέπτες και ενθάρρυνση κρατήσεων',
      text: 'Γεια σου {{first_name}}! Καλώς ήρθες στο ξενοδοχείο μας! Κάνε κράτηση και χρησιμοποίησε τον κωδικό {{discount_code}} για 15% έκπτωση. Ανυπομονούμε να σε φιλοξενήσουμε!',
      suggestedMetrics: 'Ποσοστό κρατήσεων, μετατροπή πρώτων επισκεπτών'
    }
  },
  {
    name: 'Check-in Reminder',
    category: 'hotels',
    conversionRate: 28.5,
    productViewsIncrease: 42.0,
    clickThroughRate: 18.3,
    averageOrderValue: 15.2,
    customerRetention: 35.0,
    en: {
      goal: 'Remind guests about upcoming check-in',
      text: 'Hi {{first_name}} {{last_name}}! Reminder: Your check-in is tomorrow. We\'re excited to welcome you! Use {{discount_code}} for 10% off spa services.',
      suggestedMetrics: 'Check-in completion rate, guest satisfaction'
    },
    gr: {
      goal: 'Υπενθύμιση επισκεπτών για επερχόμενη check-in',
      text: 'Γεια σου {{first_name}} {{last_name}}! Υπενθύμιση: Το check-in σου είναι αύριο. Ανυπομονούμε να σε καλωσορίσουμε! Χρησιμοποίησε τον {{discount_code}} για 10% έκπτωση στις υπηρεσίες spa.',
      suggestedMetrics: 'Ποσοστό ολοκλήρωσης check-in, ικανοποίηση επισκεπτών'
    }
  },
  {
    name: 'Room Upgrade Offer',
    category: 'hotels',
    conversionRate: 34.1,
    productViewsIncrease: 58.7,
    clickThroughRate: 26.3,
    averageOrderValue: 24.5,
    customerRetention: 26.0,
    en: {
      goal: 'Upsell room upgrades and increase revenue',
      text: '{{first_name}}, upgrade your stay! Enjoy a premium room with ocean view. Use {{discount_code}} for 20% off upgrade. Book now!',
      suggestedMetrics: 'Upgrade conversion rate, revenue per guest, guest satisfaction'
    },
    gr: {
      goal: 'Πώληση αναβάθμισης δωματίων και αύξηση εσόδων',
      text: '{{first_name}}, αναβάθμισε τη διαμονή σου! Απόλαυσε ένα premium δωμάτιο με θέα στον ωκεανό. Χρησιμοποίησε τον {{discount_code}} για 20% έκπτωση στην αναβάθμιση. Κάνε κράτηση τώρα!',
      suggestedMetrics: 'Ποσοστό μετατροπής αναβάθμισης, έσοδα ανά επισκέπτη, ικανοποίηση επισκεπτών'
    }
  },
  {
    name: 'Restaurant Promotion',
    category: 'hotels',
    conversionRate: 27.6,
    productViewsIncrease: 41.3,
    clickThroughRate: 20.4,
    averageOrderValue: 19.8,
    customerRetention: 32.0,
    en: {
      goal: 'Promote hotel restaurant and increase dining revenue',
      text: 'Hi {{first_name}}! Dine at our restaurant tonight. Use {{discount_code}} for 15% off your meal. Book your table now!',
      suggestedMetrics: 'Restaurant bookings, dining revenue, guest engagement'
    },
    gr: {
      goal: 'Προώθηση εστιατορίου ξενοδοχείου και αύξηση εσόδων εστίασης',
      text: 'Γεια σου {{first_name}}! Δείπνησε στο εστιατόριό μας απόψε. Χρησιμοποίησε τον {{discount_code}} για 15% έκπτωση στο γεύμα σου. Κάνε κράτηση τώρα!',
      suggestedMetrics: 'Κρατήσεις εστιατορίου, έσοδα εστίασης, συμμετοχή επισκεπτών'
    }
  },
  {
    name: 'Spa & Wellness Offer',
    category: 'hotels',
    conversionRate: 29.3,
    productViewsIncrease: 40.1,
    clickThroughRate: 21.2,
    averageOrderValue: 17.8,
    customerRetention: 25.0,
    en: {
      goal: 'Promote spa services and increase ancillary revenue',
      text: '{{first_name}}, relax and rejuvenate! Book a spa treatment during your stay. Use {{discount_code}} for 25% off spa packages. Limited availability!',
      suggestedMetrics: 'Spa bookings, ancillary revenue, guest satisfaction'
    },
    gr: {
      goal: 'Προώθηση υπηρεσιών spa και αύξηση συμπληρωματικών εσόδων',
      text: '{{first_name}}, χαλάρωσε και αναζωογονήσου! Κλείσε μια θεραπεία spa κατά τη διάρκεια της διαμονής σου. Χρησιμοποίησε τον {{discount_code}} για 25% έκπτωση στα πακέτα spa. Περιορισμένη διαθεσιμότητα!',
      suggestedMetrics: 'Κρατήσεις spa, συμπληρωματικά έσοδα, ικανοποίηση επισκεπτών'
    }
  },
  {
    name: 'Loyalty Program Invitation',
    category: 'hotels',
    conversionRate: 38.7,
    productViewsIncrease: 35.2,
    clickThroughRate: 24.5,
    averageOrderValue: 31.6,
    customerRetention: 45.0,
    en: {
      goal: 'Encourage loyalty program sign-ups and repeat bookings',
      text: 'Hi {{first_name}}! Join our loyalty program and earn points with every stay. Use {{discount_code}} for 10% off your next booking. Sign up today!',
      suggestedMetrics: 'Loyalty sign-up rate, repeat booking rate, guest retention'
    },
    gr: {
      goal: 'Ενθάρρυνση εγγραφών στο πρόγραμμα αφοσίωσης και επαναλαμβανόμενων κρατήσεων',
      text: 'Γεια σου {{first_name}}! Εγγράψου στο πρόγραμμα αφοσίωσης μας και κέρδισε πόντους με κάθε διαμονή. Χρησιμοποίησε τον {{discount_code}} για 10% έκπτωση στην επόμενη κράτησή σου. Εγγράψου σήμερα!',
      suggestedMetrics: 'Ποσοστό εγγραφών στο πρόγραμμα αφοσίωσης, ποσοστό επαναλαμβανόμενων κρατήσεων, διατήρηση επισκεπτών'
    }
  },
  {
    name: 'Special Event Package',
    category: 'hotels',
    conversionRate: 39.4,
    productViewsIncrease: 64.8,
    clickThroughRate: 30.6,
    averageOrderValue: 29.2,
    customerRetention: 35.0,
    en: {
      goal: 'Promote special event packages and increase bookings',
      text: '{{first_name}}, celebrate your special occasion with us! Book our event package. Use {{discount_code}} for 20% off. Make it memorable!',
      suggestedMetrics: 'Event package bookings, revenue per event, guest satisfaction'
    },
    gr: {
      goal: 'Προώθηση πακέτων ειδικών εκδηλώσεων και αύξηση κρατήσεων',
      text: '{{first_name}}, γιόρτασε την ειδική σου περίσταση μαζί μας! Κάνε κράτηση στο πακέτο εκδήλωσης μας. Χρησιμοποίησε τον {{discount_code}} για 20% έκπτωση. Κάντο αξέχαστο!',
      suggestedMetrics: 'Κρατήσεις πακέτων εκδηλώσεων, έσοδα ανά εκδήλωση, ικανοποίηση επισκεπτών'
    }
  },
];

async function seedTemplates() {
  console.log('Seeding system templates with statistics (English & Greek)...');

  try {
    // Verify system user exists
    const systemUser = await prisma.user.findUnique({
      where: { id: SYSTEM_USER_ID }
    });

    if (!systemUser) {
      console.error(`System user with ID ${SYSTEM_USER_ID} not found. Please create it first.`);
      process.exit(1);
    }

    let createdEn = 0;
    let updatedEn = 0;
    let createdGr = 0;
    let updatedGr = 0;

    for (const templateDef of templateDefinitions) {
      const { name, category, conversionRate, productViewsIncrease, clickThroughRate, averageOrderValue, customerRetention, en, gr } = templateDef;

      // Create English version
      const resultEn = await prisma.messageTemplate.upsert({
        where: {
          ownerId_name: {
            ownerId: SYSTEM_USER_ID,
            name: `${name} (EN)`
          }
        },
        update: {
          text: en.text,
          category: category,
          goal: en.goal,
          suggestedMetrics: en.suggestedMetrics,
          language: 'en',
          conversionRate: conversionRate,
          productViewsIncrease: productViewsIncrease,
          clickThroughRate: clickThroughRate,
          averageOrderValue: averageOrderValue,
          customerRetention: customerRetention,
        },
        create: {
          ownerId: SYSTEM_USER_ID,
          name: `${name} (EN)`,
          text: en.text,
          category: category,
          goal: en.goal,
          suggestedMetrics: en.suggestedMetrics,
          language: 'en',
          conversionRate: conversionRate,
          productViewsIncrease: productViewsIncrease,
          clickThroughRate: clickThroughRate,
          averageOrderValue: averageOrderValue,
          customerRetention: customerRetention,
        }
      });

      if (resultEn.createdAt.getTime() === resultEn.updatedAt.getTime()) {
        createdEn++;
      } else {
        updatedEn++;
      }

      // Create Greek version
      const resultGr = await prisma.messageTemplate.upsert({
        where: {
          ownerId_name: {
            ownerId: SYSTEM_USER_ID,
            name: `${name} (GR)`
          }
        },
        update: {
          text: gr.text,
          category: category,
          goal: gr.goal,
          suggestedMetrics: gr.suggestedMetrics,
          language: 'gr',
          conversionRate: conversionRate,
          productViewsIncrease: productViewsIncrease,
          clickThroughRate: clickThroughRate,
          averageOrderValue: averageOrderValue,
          customerRetention: customerRetention,
        },
        create: {
          ownerId: SYSTEM_USER_ID,
          name: `${name} (GR)`,
          text: gr.text,
          category: category,
          goal: gr.goal,
          suggestedMetrics: gr.suggestedMetrics,
          language: 'gr',
          conversionRate: conversionRate,
          productViewsIncrease: productViewsIncrease,
          clickThroughRate: clickThroughRate,
          averageOrderValue: averageOrderValue,
          customerRetention: customerRetention,
        }
      });

      if (resultGr.createdAt.getTime() === resultGr.updatedAt.getTime()) {
        createdGr++;
      } else {
        updatedGr++;
      }
    }

    const totalTemplates = templateDefinitions.length * 2; // English + Greek
    console.log(`✅ Seeded ${totalTemplates} templates:`);
    console.log(`   English: Created ${createdEn}, Updated ${updatedEn}`);
    console.log(`   Greek: Created ${createdGr}, Updated ${updatedGr}`);
    console.log(`\nCategories: cafe, restaurant, gym, sports_club, generic, hotels`);
    console.log('Templates are now available to all users via GET /api/templates');
    console.log('All templates support: {{first_name}}, {{last_name}}, {{discount_code}}');

  } catch (error) {
    console.error('Error seeding templates:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  seedTemplates()
    .then(() => {
      console.log('Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exit(1);
    });
}

module.exports = { seedTemplates };

