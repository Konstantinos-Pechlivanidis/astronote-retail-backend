// apps/api/scripts/seed-templates-comprehensive.js
// Comprehensive seed script: 7 templates per category in both English and Greek
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const SYSTEM_USER_ID = Number(process.env.SYSTEM_USER_ID || 1);

// Template definitions: 7 per category, each with English and Greek versions
const templateDefinitions = [
  // ========== CAFÉ / COFFEE SHOP (7 templates) ==========
  {
    name: 'Welcome New Customer',
    category: 'cafe',
    en: {
      goal: 'Welcome new customers and encourage first visit',
      text: 'Hi {{first_name}}! Welcome to our café! Enjoy 10% off your first order. Show this message at checkout. Valid until end of month.',
      suggestedMetrics: 'Conversion rate, first visit rate'
    },
    gr: {
      goal: 'Καλώς ήρθατε νέοι πελάτες και ενθάρρυνση πρώτης επίσκεψης',
      text: 'Γεια σου {{first_name}}! Καλώς ήρθες στο καφέ μας! Απόλαυσε 10% έκπτωση στην πρώτη σου παραγγελία. Δείξε αυτό το μήνυμα στο ταμείο. Ισχύει μέχρι τέλος μήνα.',
      suggestedMetrics: 'Ποσοστό μετατροπής, ποσοστό πρώτης επίσκεψης'
    }
  },
  {
    name: 'Happy Hour Promotion',
    category: 'cafe',
    en: {
      goal: 'Drive foot traffic during off-peak hours',
      text: 'Hey {{first_name}}! Happy Hour is on! 2-for-1 on all drinks from 2-4 PM today. See you soon!',
      suggestedMetrics: 'Visit frequency, redemption rate, off-peak traffic'
    },
    gr: {
      goal: 'Αύξηση επισκεψιμότητας κατά τις ώρες χαμηλής κίνησης',
      text: 'Γεια σου {{first_name}}! Happy Hour σε εξέλιξη! 2-για-1 σε όλα τα ποτά από 2-4μμ σήμερα. Τα λέμε σύντομα!',
      suggestedMetrics: 'Συχνότητα επισκέψεων, ποσοστό εξαργύρωσης, κίνηση εκτός αιχμής'
    }
  },
  {
    name: 'Loyalty Reward Reminder',
    category: 'cafe',
    en: {
      goal: 'Encourage repeat visits and loyalty program engagement',
      text: 'Hi {{first_name}}, you\'re just 2 visits away from a free coffee! Come in this week to claim your reward.',
      suggestedMetrics: 'Repeat visit rate, loyalty program engagement'
    },
    gr: {
      goal: 'Ενθάρρυνση επαναλαμβανόμενων επισκέψεων και συμμετοχής στο πρόγραμμα αφοσίωσης',
      text: 'Γεια σου {{first_name}}, απέχεις μόνο 2 επισκέψεις από ένα δωρεάν καφέ! Έλα αυτή την εβδομάδα για να διεκδικήσεις την ανταμοιβή σου.',
      suggestedMetrics: 'Ποσοστό επαναλαμβανόμενων επισκέψεων, συμμετοχή στο πρόγραμμα αφοσίωσης'
    }
  },
  {
    name: 'New Menu Item Launch',
    category: 'cafe',
    en: {
      goal: 'Promote new products and increase average order value',
      text: '{{first_name}}, we\'ve got something new! Try our seasonal special - ask about it on your next visit. Limited time only!',
      suggestedMetrics: 'Average order value, new product adoption rate'
    },
    gr: {
      goal: 'Προώθηση νέων προϊόντων και αύξηση μέσης αξίας παραγγελίας',
      text: '{{first_name}}, έχουμε κάτι καινούργιο! Δοκίμασε την εποχιακή μας προσφορά - ρώτησε για αυτή στην επόμενη επίσκεψή σου. Περιορισμένος χρόνος!',
      suggestedMetrics: 'Μέση αξία παραγγελίας, ποσοστό υιοθέτησης νέων προϊόντων'
    }
  },
  {
    name: 'Win-back Inactive Customers',
    category: 'cafe',
    en: {
      goal: 'Re-engage customers who haven\'t visited recently',
      text: 'We miss you, {{first_name}}! Come back and enjoy 15% off your next order. Valid this week only.',
      suggestedMetrics: 'Win-back rate, reactivation rate'
    },
    gr: {
      goal: 'Επανενεργοποίηση πελατών που δεν έχουν επισκεφθεί πρόσφατα',
      text: 'Σε λείπουν, {{first_name}}! Έλα πίσω και απόλαυσε 15% έκπτωση στην επόμενη παραγγελία σου. Ισχύει μόνο αυτή την εβδομάδα.',
      suggestedMetrics: 'Ποσοστό επανενεργοποίησης, ποσοστό ανάκτησης'
    }
  },
  {
    name: 'Special Event Announcement',
    category: 'cafe',
    en: {
      goal: 'Promote special events and increase foot traffic',
      text: 'Hi {{first_name}}! Join us this Saturday for our live music night. Free entry, great atmosphere! See you there!',
      suggestedMetrics: 'Event attendance, foot traffic, customer engagement'
    },
    gr: {
      goal: 'Προώθηση ειδικών εκδηλώσεων και αύξηση επισκεψιμότητας',
      text: 'Γεια σου {{first_name}}! Ελάτε μαζί μας το Σάββατο για τη μουσική βραδιά μας. Δωρεάν είσοδος, υπέροχη ατμόσφαιρα! Τα λέμε εκεί!',
      suggestedMetrics: 'Συμμετοχή σε εκδηλώσεις, επισκεψιμότητα, συμμετοχή πελατών'
    }
  },
  {
    name: 'Seasonal Promotion',
    category: 'cafe',
    en: {
      goal: 'Promote seasonal offers and drive sales',
      text: '{{first_name}}, our autumn special is here! Try our pumpkin spice latte and get a free pastry. Limited time offer!',
      suggestedMetrics: 'Seasonal sales, average order value, customer visits'
    },
    gr: {
      goal: 'Προώθηση εποχιακών προσφορών και αύξηση πωλήσεων',
      text: '{{first_name}}, η φθινοπωρινή μας προσφορά είναι εδώ! Δοκίμασε το pumpkin spice latte μας και πάρε ένα δωρεάν γλυκό. Προσφορά περιορισμένου χρόνου!',
      suggestedMetrics: 'Εποχιακές πωλήσεις, μέση αξία παραγγελίας, επισκέψεις πελατών'
    }
  },

  // ========== RESTAURANT / FOOD (7 templates) ==========
  {
    name: 'Weekend Special Offer',
    category: 'restaurant',
    en: {
      goal: 'Increase weekend bookings and revenue',
      text: 'Hi {{first_name}}! This weekend, enjoy our special 3-course menu for just €25. Book your table now!',
      suggestedMetrics: 'Booking rate, weekend revenue, average spend'
    },
    gr: {
      goal: 'Αύξηση κρατήσεων και εσόδων για το σαββατοκύριακο',
      text: 'Γεια σου {{first_name}}! Αυτό το σαββατοκύριακο, απολαύστε το ειδικό μας μενού 3 πιάτων για μόνο €25. Κάντε κράτηση τώρα!',
      suggestedMetrics: 'Ποσοστό κρατήσεων, έσοδα σαββατοκύριακου, μέση δαπάνη'
    }
  },
  {
    name: 'Birthday Special',
    category: 'restaurant',
    en: {
      goal: 'Celebrate customer birthdays and drive visits',
      text: 'Happy Birthday {{first_name}}! Celebrate with us - enjoy a complimentary dessert with any main course this month.',
      suggestedMetrics: 'Birthday visit rate, customer satisfaction'
    },
    gr: {
      goal: 'Γιορτάστε τα γενέθλια των πελατών και αυξήστε τις επισκέψεις',
      text: 'Χρόνια Πολλά {{first_name}}! Γιόρτασε μαζί μας - απολαύστε ένα δωρεάν επιδόρπιο με οποιοδήποτε κυρίως πιάτο αυτόν τον μήνα.',
      suggestedMetrics: 'Ποσοστό επισκέψεων γενεθλίων, ικανοποίηση πελατών'
    }
  },
  {
    name: 'Lunch Deal Promotion',
    category: 'restaurant',
    en: {
      goal: 'Drive lunch traffic and increase midday revenue',
      text: '{{first_name}}, our lunch special is back! €12 for main + drink, Mon-Fri 12-3 PM. Book your table!',
      suggestedMetrics: 'Lunch traffic, weekday revenue'
    },
    gr: {
      goal: 'Αύξηση κίνησης μεσημεριανών και εσόδων μεσημέρι',
      text: '{{first_name}}, η μεσημεριανή μας προσφορά επέστρεψε! €12 για κυρίως πιάτο + ποτό, Δευ-Παρ 12-3μμ. Κάντε κράτηση!',
      suggestedMetrics: 'Κίνηση μεσημεριανών, έσοδα εβδομάδας'
    }
  },
  {
    name: 'Event Announcement',
    category: 'restaurant',
    en: {
      goal: 'Promote special events and increase bookings',
      text: 'Hi {{first_name}}! Join us this Friday for live music and special menu. Limited tables - reserve now!',
      suggestedMetrics: 'Event attendance, booking rate'
    },
    gr: {
      goal: 'Προώθηση ειδικών εκδηλώσεων και αύξηση κρατήσεων',
      text: 'Γεια σου {{first_name}}! Ελάτε μαζί μας την Παρασκευή για ζωντανή μουσική και ειδικό μενού. Περιορισμένοι πίνακες - κάντε κράτηση τώρα!',
      suggestedMetrics: 'Συμμετοχή σε εκδηλώσεις, ποσοστό κρατήσεων'
    }
  },
  {
    name: 'Loyalty Program Update',
    category: 'restaurant',
    en: {
      goal: 'Encourage repeat visits and loyalty program sign-ups',
      text: '{{first_name}}, join our loyalty program! Earn points with every visit. Your next meal could be on us!',
      suggestedMetrics: 'Loyalty sign-up rate, repeat visit frequency'
    },
    gr: {
      goal: 'Ενθάρρυνση επαναλαμβανόμενων επισκέψεων και εγγραφών στο πρόγραμμα αφοσίωσης',
      text: '{{first_name}}, εγγράψου στο πρόγραμμα αφοσίωσης μας! Κέρδισε πόντους με κάθε επίσκεψη. Το επόμενο γεύμα σου μπορεί να είναι δικό μας!',
      suggestedMetrics: 'Ποσοστό εγγραφών στο πρόγραμμα αφοσίωσης, συχνότητα επαναλαμβανόμενων επισκέψεων'
    }
  },
  {
    name: 'New Menu Launch',
    category: 'restaurant',
    en: {
      goal: 'Promote new menu items and increase visits',
      text: '{{first_name}}, we\'ve updated our menu! Try our new dishes and get 10% off your first order from the new menu.',
      suggestedMetrics: 'New menu adoption, visit frequency, average order value'
    },
    gr: {
      goal: 'Προώθηση νέων στοιχείων μενού και αύξηση επισκέψεων',
      text: '{{first_name}}, ανανεώσαμε το μενού μας! Δοκίμασε τα νέα μας πιάτα και πάρε 10% έκπτωση στην πρώτη παραγγελία από το νέο μενού.',
      suggestedMetrics: 'Υιοθέτηση νέου μενού, συχνότητα επισκέψεων, μέση αξία παραγγελίας'
    }
  },
  {
    name: 'Holiday Special',
    category: 'restaurant',
    en: {
      goal: 'Promote holiday specials and increase bookings',
      text: 'Hi {{first_name}}! Celebrate the holidays with us. Special festive menu available all December. Book your table today!',
      suggestedMetrics: 'Holiday bookings, seasonal revenue, customer engagement'
    },
    gr: {
      goal: 'Προώθηση ειδικών προσφορών αργιών και αύξηση κρατήσεων',
      text: 'Γεια σου {{first_name}}! Γιόρτασε τις γιορτές μαζί μας. Ειδικό εορταστικό μενού διαθέσιμο όλο τον Δεκέμβριο. Κάντε κράτηση σήμερα!',
      suggestedMetrics: 'Κρατήσεις αργιών, εποχιακά έσοδα, συμμετοχή πελατών'
    }
  },

  // ========== GYM / FITNESS (7 templates) ==========
  {
    name: 'New Member Welcome',
    category: 'gym',
    en: {
      goal: 'Welcome new members and encourage first visit',
      text: 'Welcome {{first_name}}! Your membership is active. Book your free orientation session this week. Let\'s get started!',
      suggestedMetrics: 'First visit rate, orientation attendance'
    },
    gr: {
      goal: 'Καλώς ήρθατε νέα μέλη και ενθάρρυνση πρώτης επίσκεψης',
      text: 'Καλώς ήρθες {{first_name}}! Η συνδρομή σου είναι ενεργή. Κλείσε την δωρεάν συνεδρία προσανατολισμού σου αυτή την εβδομάδα. Ας ξεκινήσουμε!',
      suggestedMetrics: 'Ποσοστό πρώτης επίσκεψης, συμμετοχή σε προσανατολισμό'
    }
  },
  {
    name: 'Class Reminder',
    category: 'gym',
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
    en: {
      goal: 'Re-engage members who haven\'t visited recently',
      text: 'We miss you {{first_name}}! Your membership is still active. Come back this week and get a free personal training session.',
      suggestedMetrics: 'Member reactivation rate, retention rate'
    },
    gr: {
      goal: 'Επανενεργοποίηση μελών που δεν έχουν επισκεφθεί πρόσφατα',
      text: 'Σε λείπουν {{first_name}}! Η συνδρομή σου είναι ακόμα ενεργή. Έλα πίσω αυτή την εβδομάδα και πάρε μια δωρεάν προσωπική προπόνηση.',
      suggestedMetrics: 'Ποσοστό επανενεργοποίησης μελών, ποσοστό διατήρησης'
    }
  },
  {
    name: 'New Class Launch',
    category: 'gym',
    en: {
      goal: 'Promote new classes and increase participation',
      text: '{{first_name}}, we\'re launching a new class! First session is free for all members. Book your spot!',
      suggestedMetrics: 'New class adoption, class attendance'
    },
    gr: {
      goal: 'Προώθηση νέων μαθημάτων και αύξηση συμμετοχής',
      text: '{{first_name}}, ξεκινάμε ένα νέο μάθημα! Η πρώτη συνεδρία είναι δωρεάν για όλα τα μέλη. Κλείσε τη θέση σου!',
      suggestedMetrics: 'Υιοθέτηση νέου μαθήματος, συμμετοχή σε μαθήματα'
    }
  },
  {
    name: 'Achievement Celebration',
    category: 'gym',
    en: {
      goal: 'Celebrate member milestones and build community',
      text: 'Congratulations {{first_name}}! You\'ve hit an amazing milestone. Keep up the great work - you\'re inspiring others!',
      suggestedMetrics: 'Member engagement, community building'
    },
    gr: {
      goal: 'Γιορτάστε τα ορόσημα των μελών και δημιουργία κοινότητας',
      text: 'Συγχαρητήρια {{first_name}}! Έφτασες ένα καταπληκτικό ορόσημο. Συνέχισε την εξαιρετική δουλειά - εμπνέεις άλλους!',
      suggestedMetrics: 'Συμμετοχή μελών, δημιουργία κοινότητας'
    }
  },
  {
    name: 'Personal Training Offer',
    category: 'gym',
    en: {
      goal: 'Promote personal training services and increase revenue',
      text: 'Hi {{first_name}}! Ready to take your fitness to the next level? Book a personal training session and get 20% off your first package.',
      suggestedMetrics: 'Personal training bookings, revenue per member, member satisfaction'
    },
    gr: {
      goal: 'Προώθηση υπηρεσιών προσωπικής προπόνησης και αύξηση εσόδων',
      text: 'Γεια σου {{first_name}}! Έτοιμος να πάς τη φυσική σου κατάσταση στο επόμενο επίπεδο; Κλείσε μια προσωπική προπόνηση και πάρε 20% έκπτωση στο πρώτο πακέτο σου.',
      suggestedMetrics: 'Κρατήσεις προσωπικής προπόνησης, έσοδα ανά μέλος, ικανοποίηση μελών'
    }
  },
  {
    name: 'Equipment Update',
    category: 'gym',
    en: {
      goal: 'Inform members about new equipment and encourage visits',
      text: '{{first_name}}, we\'ve upgraded! New state-of-the-art equipment is now available. Come try it out this week!',
      suggestedMetrics: 'Member visits, equipment usage, member satisfaction'
    },
    gr: {
      goal: 'Ενημέρωση μελών για νέο εξοπλισμό και ενθάρρυνση επισκέψεων',
      text: '{{first_name}}, αναβαθμίσαμε! Νέος σύγχρονος εξοπλισμός είναι τώρα διαθέσιμος. Έλα να τον δοκιμάσεις αυτή την εβδομάδα!',
      suggestedMetrics: 'Επισκέψεις μελών, χρήση εξοπλισμού, ικανοποίηση μελών'
    }
  },

  // ========== SPORTS CLUB / TEAM (7 templates) ==========
  {
    name: 'Match Reminder',
    category: 'sports_club',
    en: {
      goal: 'Ensure team attendance and reduce no-shows',
      text: 'Hi {{first_name}}, match reminder this week! Check the schedule for details. See you there!',
      suggestedMetrics: 'Attendance rate, no-show reduction'
    },
    gr: {
      goal: 'Εξασφάλιση παρουσίας ομάδας και μείωση απουσιών',
      text: 'Γεια σου {{first_name}}, υπενθύμιση αγώνα αυτή την εβδομάδα! Ελέγξτε το πρόγραμμα για λεπτομέρειες. Τα λέμε εκεί!',
      suggestedMetrics: 'Ποσοστό παρουσίας, μείωση απουσιών'
    }
  },
  {
    name: 'Training Session Update',
    category: 'sports_club',
    en: {
      goal: 'Keep members informed about schedule changes',
      text: '{{first_name}}, training update: This week\'s session schedule has changed. Please check the updated times. See you there!',
      suggestedMetrics: 'Attendance rate, communication effectiveness'
    },
    gr: {
      goal: 'Ενημέρωση μελών για αλλαγές προγράμματος',
      text: '{{first_name}}, ενημέρωση προπόνησης: Το πρόγραμμα συνεδριών αυτής της εβδομάδας έχει αλλάξει. Παρακαλώ ελέγξτε τις ενημερωμένες ώρες. Τα λέμε εκεί!',
      suggestedMetrics: 'Ποσοστό παρουσίας, αποτελεσματικότητα επικοινωνίας'
    }
  },
  {
    name: 'Team Event Announcement',
    category: 'sports_club',
    en: {
      goal: 'Promote team events and build community',
      text: 'Hi {{first_name}}! Team event coming up soon. All members welcome. Check details and RSVP!',
      suggestedMetrics: 'Event attendance, member engagement'
    },
    gr: {
      goal: 'Προώθηση εκδηλώσεων ομάδας και δημιουργία κοινότητας',
      text: 'Γεια σου {{first_name}}! Εκδήλωση ομάδας έρχεται σύντομα. Όλα τα μέλη είναι ευπρόσδεκτα. Ελέγξτε τις λεπτομέρειες και επιβεβαιώστε!',
      suggestedMetrics: 'Συμμετοχή σε εκδηλώσεις, συμμετοχή μελών'
    }
  },
  {
    name: 'New Member Welcome',
    category: 'sports_club',
    en: {
      goal: 'Welcome new team members and encourage participation',
      text: 'Welcome to the team {{first_name}}! Your first training session details have been sent. Looking forward to meeting you!',
      suggestedMetrics: 'First session attendance, member retention'
    },
    gr: {
      goal: 'Καλώς ήρθατε νέα μέλη ομάδας και ενθάρρυνση συμμετοχής',
      text: 'Καλώς ήρθες στην ομάδα {{first_name}}! Οι λεπτομέρειες της πρώτης προπόνησης έχουν σταλεί. Ανυπομονούμε να σε γνωρίσουμε!',
      suggestedMetrics: 'Συμμετοχή πρώτης συνεδρίας, διατήρηση μελών'
    }
  },
  {
    name: 'Achievement Recognition',
    category: 'sports_club',
    en: {
      goal: 'Celebrate team achievements and boost morale',
      text: 'Amazing work {{first_name}}! Your dedication is making a difference. Keep it up - the team is proud!',
      suggestedMetrics: 'Member engagement, team morale'
    },
    gr: {
      goal: 'Γιορτάστε τα επιτεύγματα της ομάδας και ενίσχυση ηθικού',
      text: 'Εξαιρετική δουλειά {{first_name}}! Η αφοσίωσή σου κάνει τη διαφορά. Συνέχισε - η ομάδα είναι περήφανη!',
      suggestedMetrics: 'Συμμετοχή μελών, ηθικό ομάδας'
    }
  },
  {
    name: 'Tournament Announcement',
    category: 'sports_club',
    en: {
      goal: 'Promote tournaments and increase participation',
      text: '{{first_name}}, tournament registration is open! Join us for the upcoming championship. Sign up by Friday!',
      suggestedMetrics: 'Tournament participation, member engagement, team building'
    },
    gr: {
      goal: 'Προώθηση τουρνουά και αύξηση συμμετοχής',
      text: '{{first_name}}, οι εγγραφές στο τουρνουά είναι ανοιχτές! Ελάτε μαζί μας για το επερχόμενο πρωτάθλημα. Εγγραφείτε μέχρι Παρασκευή!',
      suggestedMetrics: 'Συμμετοχή σε τουρνουά, συμμετοχή μελών, ομαδοποίηση'
    }
  },
  {
    name: 'Equipment Maintenance Notice',
    category: 'sports_club',
    en: {
      goal: 'Inform members about facility updates',
      text: 'Hi {{first_name}}, facility update: New equipment installed and facility improvements completed. Come check it out!',
      suggestedMetrics: 'Member visits, facility usage, member satisfaction'
    },
    gr: {
      goal: 'Ενημέρωση μελών για ενημερώσεις εγκαταστάσεων',
      text: 'Γεια σου {{first_name}}, ενημέρωση εγκαταστάσεων: Νέος εξοπλισμός εγκαταστάθηκε και οι βελτιώσεις ολοκληρώθηκαν. Έλα να το δεις!',
      suggestedMetrics: 'Επισκέψεις μελών, χρήση εγκαταστάσεων, ικανοποίηση μελών'
    }
  },

  // ========== GENERIC / ANY BUSINESS (7 templates) ==========
  {
    name: 'Flash Sale Alert',
    category: 'generic',
    en: {
      goal: 'Drive immediate sales with time-limited offers',
      text: '{{first_name}}, flash sale! 20% off everything today only. Use code FLASH20 at checkout. Don\'t miss out!',
      suggestedMetrics: 'Conversion rate, sales volume, urgency response'
    },
    gr: {
      goal: 'Αύξηση άμεσων πωλήσεων με προσφορές περιορισμένου χρόνου',
      text: '{{first_name}}, flash sale! 20% έκπτωση σε όλα μόνο σήμερα. Χρησιμοποίησε τον κωδικό FLASH20 στο checkout. Μην το χάσεις!',
      suggestedMetrics: 'Ποσοστό μετατροπής, όγκος πωλήσεων, απόκριση σε επείγον'
    }
  },
  {
    name: 'Seasonal Promotion',
    category: 'generic',
    en: {
      goal: 'Promote seasonal offers and increase sales',
      text: 'Hi {{first_name}}! Our seasonal special is here. Enjoy exclusive deals all month long. Visit us soon!',
      suggestedMetrics: 'Seasonal sales, visit frequency'
    },
    gr: {
      goal: 'Προώθηση εποχιακών προσφορών και αύξηση πωλήσεων',
      text: 'Γεια σου {{first_name}}! Η εποχιακή μας προσφορά είναι εδώ. Απόλαυσε αποκλειστικές προσφορές όλο τον μήνα. Επισκέψου μας σύντομα!',
      suggestedMetrics: 'Εποχιακές πωλήσεις, συχνότητα επισκέψεων'
    }
  },
  {
    name: 'Customer Feedback Request',
    category: 'generic',
    en: {
      goal: 'Gather feedback and improve customer experience',
      text: 'Hi {{first_name}}, we\'d love your feedback! Share your experience and get 10% off your next visit. Thank you!',
      suggestedMetrics: 'Feedback response rate, customer satisfaction'
    },
    gr: {
      goal: 'Συλλογή σχολίων και βελτίωση εμπειρίας πελατών',
      text: 'Γεια σου {{first_name}}, θα θέλαμε τα σχόλιά σου! Μοιράσου την εμπειρία σου και πάρε 10% έκπτωση στην επόμενη επίσκεψή σου. Ευχαριστούμε!',
      suggestedMetrics: 'Ποσοστό απόκρισης σε σχόλια, ικανοποίηση πελατών'
    }
  },
  {
    name: 'Referral Program',
    category: 'generic',
    en: {
      goal: 'Encourage referrals and grow customer base',
      text: '{{first_name}}, refer a friend and you both get a special reward! Contact us for your unique referral code.',
      suggestedMetrics: 'Referral rate, new customer acquisition'
    },
    gr: {
      goal: 'Ενθάρρυνση παραπομπών και ανάπτυξη βάσης πελατών',
      text: '{{first_name}}, συνέστησε έναν φίλο και και οι δύο παίρνετε μια ειδική ανταμοιβή! Επικοινώνησε μαζί μας για τον μοναδικό σου κωδικό παραπομπής.',
      suggestedMetrics: 'Ποσοστό παραπομπών, απόκτηση νέων πελατών'
    }
  },
  {
    name: 'Thank You Message',
    category: 'generic',
    en: {
      goal: 'Show appreciation and encourage repeat business',
      text: 'Thank you {{first_name}} for being a valued customer! We appreciate your support. See you again soon!',
      suggestedMetrics: 'Customer retention, loyalty metrics'
    },
    gr: {
      goal: 'Εκδήλωση εκτίμησης και ενθάρρυνση επαναλαμβανόμενων συναλλαγών',
      text: 'Ευχαριστούμε {{first_name}} που είσαι πολύτιμος πελάτης! Εκτιμούμε την υποστήριξή σου. Τα λέμε σύντομα!',
      suggestedMetrics: 'Διατήρηση πελατών, μετρικές αφοσίωσης'
    }
  },
  {
    name: 'New Product Launch',
    category: 'generic',
    en: {
      goal: 'Announce new products and drive sales',
      text: '{{first_name}}, exciting news! We\'ve launched new products. Be among the first to try them and get 15% off your first purchase.',
      suggestedMetrics: 'New product adoption, sales volume, customer engagement'
    },
    gr: {
      goal: 'Ανακοίνωση νέων προϊόντων και αύξηση πωλήσεων',
      text: '{{first_name}}, συναρπαστικά νέα! Κάναμε launch νέα προϊόντα. Γίνε από τους πρώτους που θα τα δοκιμάσουν και πάρε 15% έκπτωση στην πρώτη αγορά σου.',
      suggestedMetrics: 'Υιοθέτηση νέων προϊόντων, όγκος πωλήσεων, συμμετοχή πελατών'
    }
  },
  {
    name: 'Loyalty Points Reminder',
    category: 'generic',
    en: {
      goal: 'Encourage redemption and increase engagement',
      text: 'Hi {{first_name}}, you have loyalty points expiring soon! Use them before they expire and save on your next purchase.',
      suggestedMetrics: 'Points redemption rate, customer engagement, repeat purchases'
    },
    gr: {
      goal: 'Ενθάρρυνση εξαργύρωσης και αύξηση συμμετοχής',
      text: 'Γεια σου {{first_name}}, έχεις πόντους αφοσίωσης που λήγουν σύντομα! Χρησιμοποίησέ τους πριν λήξουν και εξοικονόμησε στην επόμενη αγορά σου.',
      suggestedMetrics: 'Ποσοστό εξαργύρωσης πόντων, συμμετοχή πελατών, επαναλαμβανόμενες αγορές'
    }
  }
];

async function seedTemplatesComprehensive() {
  console.log('=== Seeding Comprehensive Templates ===\n');
  console.log(`Total template definitions: ${templateDefinitions.length}`);
  console.log(`Expected templates: ${templateDefinitions.length * 2} (${templateDefinitions.length} × 2 languages)\n`);

  try {
    // Verify system user exists
    const systemUser = await prisma.user.findUnique({
      where: { id: SYSTEM_USER_ID }
    });

    if (!systemUser) {
      console.error(`❌ System user with ID ${SYSTEM_USER_ID} not found. Please create it first.`);
      process.exit(1);
    }

    console.log(`✅ System user found: ${systemUser.email || systemUser.id}\n`);

    let created = 0;
    let updated = 0;
    const skipped = 0;

    // Process each template definition and create both English and Greek versions
    for (const def of templateDefinitions) {
      // Create English version
      // Note: Using same name for both languages - the unique constraint [ownerId, name] requires different names
      // We'll use a language suffix to differentiate, but display clean names in frontend
      const enResult = await prisma.messageTemplate.upsert({
        where: {
          ownerId_name: {
            ownerId: SYSTEM_USER_ID,
            name: `${def.name}`
          }
        },
        update: {
          text: def.en.text,
          category: def.category,
          goal: def.en.goal,
          suggestedMetrics: def.en.suggestedMetrics,
          language: 'en'
        },
        create: {
          ownerId: SYSTEM_USER_ID,
          name: `${def.name}`,
          text: def.en.text,
          category: def.category,
          goal: def.en.goal,
          suggestedMetrics: def.en.suggestedMetrics,
          language: 'en'
        }
      });

      if (enResult.createdAt.getTime() === enResult.updatedAt.getTime()) {
        created++;
      } else {
        updated++;
      }

      // Create Greek version with different name to satisfy unique constraint
      // Frontend will filter by language, so both can coexist
      const grName = `${def.name}_GR`;
      const grResult = await prisma.messageTemplate.upsert({
        where: {
          ownerId_name: {
            ownerId: SYSTEM_USER_ID,
            name: grName
          }
        },
        update: {
          text: def.gr.text,
          category: def.category,
          goal: def.gr.goal,
          suggestedMetrics: def.gr.suggestedMetrics,
          language: 'gr'
        },
        create: {
          ownerId: SYSTEM_USER_ID,
          name: grName,
          text: def.gr.text,
          category: def.category,
          goal: def.gr.goal,
          suggestedMetrics: def.gr.suggestedMetrics,
          language: 'gr'
        }
      });

      if (grResult.createdAt.getTime() === grResult.updatedAt.getTime()) {
        created++;
      } else {
        updated++;
      }
    }

    // Summary by category and language
    const summary = await prisma.messageTemplate.groupBy({
      by: ['category', 'language'],
      where: { ownerId: SYSTEM_USER_ID },
      _count: { id: true }
    });

    console.log('✅ Seeding complete!\n');
    console.log(`   - Created: ${created}`);
    console.log(`   - Updated: ${updated}`);
    console.log(`   - Skipped: ${skipped}\n`);

    console.log('📊 Template distribution:\n');
    const categories = ['cafe', 'restaurant', 'gym', 'sports_club', 'generic'];
    for (const cat of categories) {
      const enCount = summary.find(s => s.category === cat && s.language === 'en')?._count.id || 0;
      const grCount = summary.find(s => s.category === cat && s.language === 'gr')?._count.id || 0;
      console.log(`   ${cat.padEnd(12)}: ${enCount} EN, ${grCount} GR (Total: ${enCount + grCount})`);
    }

    console.log('\n✅ Templates are now available to all users via GET /api/templates?language=en or ?language=gr');
    console.log('✅ Frontend will automatically filter by current i18n language');

  } catch (error) {
    console.error('❌ Error seeding templates:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  seedTemplatesComprehensive()
    .then(() => {
      console.log('\n✅ Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Seed failed:', error);
      process.exit(1);
    });
}

module.exports = { seedTemplatesComprehensive };

