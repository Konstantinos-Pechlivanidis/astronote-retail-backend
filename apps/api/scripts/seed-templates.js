// apps/api/scripts/seed-templates.js
// Seed script for system-level message templates
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SYSTEM_USER_ID = Number(process.env.SYSTEM_USER_ID || 1);

const templates = [
  // CAFÉ / COFFEE SHOP (5 templates)
  {
    name: 'Welcome New Customer',
    category: 'cafe',
    goal: 'Welcome new customers and encourage first visit',
    text: 'Hi {{first_name}}! Welcome to our café! Enjoy 10% off your first order. Show this message at checkout. Valid until end of month.',
    suggestedMetrics: 'Conversion rate, first visit rate',
    language: 'en'
  },
  {
    name: 'Happy Hour Promotion',
    category: 'cafe',
    goal: 'Drive foot traffic during off-peak hours',
    text: 'Hey {{first_name}}! Happy Hour is on! 2-for-1 on all drinks from 2-4 PM today. See you soon!',
    suggestedMetrics: 'Visit frequency, redemption rate, off-peak traffic',
    language: 'en'
  },
  {
    name: 'Loyalty Reward Reminder',
    category: 'cafe',
    goal: 'Encourage repeat visits and loyalty program engagement',
    text: 'Hi {{first_name}}, you\'re just 2 visits away from a free coffee! Come in this week to claim your reward.',
    suggestedMetrics: 'Repeat visit rate, loyalty program engagement',
    language: 'en'
  },
  {
    name: 'New Menu Item Launch',
    category: 'cafe',
    goal: 'Promote new products and increase average order value',
    text: '{{first_name}}, we\'ve got something new! Try our seasonal special - ask about it on your next visit. Limited time only!',
    suggestedMetrics: 'Average order value, new product adoption rate',
    language: 'en'
  },
  {
    name: 'Win-back Inactive Customers',
    category: 'cafe',
    goal: 'Re-engage customers who haven\'t visited recently',
    text: 'We miss you, {{first_name}}! Come back and enjoy 15% off your next order. Valid this week only.',
    suggestedMetrics: 'Win-back rate, reactivation rate',
    language: 'en'
  },

  // RESTAURANT / BAR (5 templates)
  {
    name: 'Weekend Special Offer',
    category: 'restaurant',
    goal: 'Increase weekend bookings and revenue',
    text: 'Hi {{first_name}}! This weekend, enjoy our special 3-course menu for just €25. Book your table now!',
    suggestedMetrics: 'Booking rate, weekend revenue, average spend',
    language: 'en'
  },
  {
    name: 'Birthday Special',
    category: 'restaurant',
    goal: 'Celebrate customer birthdays and drive visits',
    text: 'Happy Birthday {{first_name}}! Celebrate with us - enjoy a complimentary dessert with any main course this month.',
    suggestedMetrics: 'Birthday visit rate, customer satisfaction',
    language: 'en'
  },
  {
    name: 'Lunch Deal Promotion',
    category: 'restaurant',
    goal: 'Drive lunch traffic and increase midday revenue',
    text: '{{first_name}}, our lunch special is back! €12 for main + drink, Mon-Fri 12-3 PM. Book your table!',
    suggestedMetrics: 'Lunch traffic, weekday revenue',
    language: 'en'
  },
  {
    name: 'Event Announcement',
    category: 'restaurant',
    goal: 'Promote special events and increase bookings',
    text: 'Hi {{first_name}}! Join us this Friday for live music and special menu. Limited tables - reserve now!',
    suggestedMetrics: 'Event attendance, booking rate',
    language: 'en'
  },
  {
    name: 'Loyalty Program Update',
    category: 'restaurant',
    goal: 'Encourage repeat visits and loyalty program sign-ups',
    text: '{{first_name}}, join our loyalty program! Earn points with every visit. Your next meal could be on us!',
    suggestedMetrics: 'Loyalty sign-up rate, repeat visit frequency',
    language: 'en'
  },

  // GYM / FITNESS STUDIO (5 templates)
  {
    name: 'New Member Welcome',
    category: 'gym',
    goal: 'Welcome new members and encourage first visit',
    text: 'Welcome {{first_name}}! Your membership is active. Book your free orientation session this week. Let\'s get started!',
    suggestedMetrics: 'First visit rate, orientation attendance',
    language: 'en'
  },
  {
    name: 'Class Reminder',
    category: 'gym',
    goal: 'Reduce no-shows and increase class attendance',
    text: 'Hi {{first_name}}! Reminder: Your class is tomorrow. See you there!',
    suggestedMetrics: 'Class attendance rate, no-show reduction',
    language: 'en'
  },
  {
    name: 'Win-back Inactive Members',
    category: 'gym',
    goal: 'Re-engage members who haven\'t visited recently',
    text: 'We miss you {{first_name}}! Your membership is still active. Come back this week and get a free personal training session.',
    suggestedMetrics: 'Member reactivation rate, retention rate',
    language: 'en'
  },
  {
    name: 'New Class Launch',
    category: 'gym',
    goal: 'Promote new classes and increase participation',
    text: '{{first_name}}, we\'re launching a new class! First session is free for all members. Book your spot!',
    suggestedMetrics: 'New class adoption, class attendance',
    language: 'en'
  },
  {
    name: 'Achievement Celebration',
    category: 'gym',
    goal: 'Celebrate member milestones and build community',
    text: 'Congratulations {{first_name}}! You\'ve hit an amazing milestone. Keep up the great work - you\'re inspiring others!',
    suggestedMetrics: 'Member engagement, community building',
    language: 'en'
  },

  // SPORTS CLUB / TEAM (5 templates)
  {
    name: 'Match Reminder',
    category: 'sports_club',
    goal: 'Ensure team attendance and reduce no-shows',
    text: 'Hi {{first_name}}, match reminder this week! Check the schedule for details. See you there!',
    suggestedMetrics: 'Attendance rate, no-show reduction',
    language: 'en'
  },
  {
    name: 'Training Session Update',
    category: 'sports_club',
    goal: 'Keep members informed about schedule changes',
    text: '{{first_name}}, training update: This week\'s session schedule has changed. Please check the updated times. See you there!',
    suggestedMetrics: 'Attendance rate, communication effectiveness',
    language: 'en'
  },
  {
    name: 'Team Event Announcement',
    category: 'sports_club',
    goal: 'Promote team events and build community',
    text: 'Hi {{first_name}}! Team event coming up soon. All members welcome. Check details and RSVP!',
    suggestedMetrics: 'Event attendance, member engagement',
    language: 'en'
  },
  {
    name: 'New Member Welcome',
    category: 'sports_club',
    goal: 'Welcome new team members and encourage participation',
    text: 'Welcome to the team {{first_name}}! Your first training session details have been sent. Looking forward to meeting you!',
    suggestedMetrics: 'First session attendance, member retention',
    language: 'en'
  },
  {
    name: 'Achievement Recognition',
    category: 'sports_club',
    goal: 'Celebrate team achievements and boost morale',
    text: 'Amazing work {{first_name}}! Your dedication is making a difference. Keep it up - the team is proud!',
    suggestedMetrics: 'Member engagement, team morale',
    language: 'en'
  },

  // GENERIC / ANY BUSINESS (5 templates)
  {
    name: 'Flash Sale Alert',
    category: 'generic',
    goal: 'Drive immediate sales with time-limited offers',
    text: '{{first_name}}, flash sale! 20% off everything today only. Use code FLASH20 at checkout. Don\'t miss out!',
    suggestedMetrics: 'Conversion rate, sales volume, urgency response',
    language: 'en'
  },
  {
    name: 'Seasonal Promotion',
    category: 'generic',
    goal: 'Promote seasonal offers and increase sales',
    text: 'Hi {{first_name}}! Our seasonal special is here. Enjoy exclusive deals all month long. Visit us soon!',
    suggestedMetrics: 'Seasonal sales, visit frequency',
    language: 'en'
  },
  {
    name: 'Customer Feedback Request',
    category: 'generic',
    goal: 'Gather feedback and improve customer experience',
    text: 'Hi {{first_name}}, we\'d love your feedback! Share your experience and get 10% off your next visit. Thank you!',
    suggestedMetrics: 'Feedback response rate, customer satisfaction',
    language: 'en'
  },
  {
    name: 'Referral Program',
    category: 'generic',
    goal: 'Encourage referrals and grow customer base',
    text: '{{first_name}}, refer a friend and you both get a special reward! Contact us for your unique referral code.',
    suggestedMetrics: 'Referral rate, new customer acquisition',
    language: 'en'
  },
  {
    name: 'Thank You Message',
    category: 'generic',
    goal: 'Show appreciation and encourage repeat business',
    text: 'Thank you {{first_name}} for being a valued customer! We appreciate your support. See you again soon!',
    suggestedMetrics: 'Customer retention, loyalty metrics',
    language: 'en'
  }
];

async function seedTemplates() {
  console.log('Seeding system templates...');

  try {
    // Verify system user exists
    const systemUser = await prisma.user.findUnique({
      where: { id: SYSTEM_USER_ID }
    });

    if (!systemUser) {
      console.error(`System user with ID ${SYSTEM_USER_ID} not found. Please create it first.`);
      process.exit(1);
    }

    let created = 0;
    let updated = 0;

    for (const template of templates) {
      // Templates use {{first_name}} and {{last_name}} format (with underscores)
      // Render function supports both {{first_name}} and {{firstName}} formats for backward compatibility
      
      const result = await prisma.messageTemplate.upsert({
        where: {
          ownerId_name: {
            ownerId: SYSTEM_USER_ID,
            name: template.name
          }
        },
        update: {
          text: template.text,
          category: template.category,
          goal: template.goal,
          suggestedMetrics: template.suggestedMetrics,
          language: template.language || 'en'
        },
        create: {
          ownerId: SYSTEM_USER_ID,
          name: template.name,
          text: template.text,
          category: template.category,
          goal: template.goal,
          suggestedMetrics: template.suggestedMetrics,
          language: template.language || 'en'
        }
      });

      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        created++;
      } else {
        updated++;
      }
    }

    console.log(`✅ Seeded ${templates.length} templates (English):`);
    console.log(`   - Created: ${created}`);
    console.log(`   - Updated: ${updated}`);
    console.log('\nTemplates are now available to all users via GET /api/templates');
    console.log('Note: To add Greek templates, create them with language="gr" and unique names per category.');

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

