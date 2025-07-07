// Mobile menu functionality with improved accessibility
function toggleMobileMenu() {
  const navLinks = document.querySelector('.nav-links');
  const menuToggle = document.querySelector('.mobile-menu-toggle');

  const isActive = navLinks.classList.toggle('active');

  // Change menu icon
  if (isActive) {
    menuToggle.textContent = '✕';
  } else {
    menuToggle.textContent = '☰';
  }

  // Update ARIA attributes
  menuToggle.setAttribute('aria-expanded', isActive ? 'true' : 'false');
}

// Initialize accessibility features
document.addEventListener('DOMContentLoaded', () => {
  const menuToggle = document.querySelector('.mobile-menu-toggle');
  const navLinks = document.querySelector('.nav-links');
  
  if (menuToggle && navLinks) {
    // Ensure navLinks has an id for aria-controls
    if (!navLinks.id) {
      navLinks.id = 'nav-links';
    }
    
    // Set up ARIA attributes
    menuToggle.setAttribute('aria-controls', navLinks.id);
    menuToggle.setAttribute('aria-expanded', navLinks.classList.contains('active') ? 'true' : 'false');
    menuToggle.setAttribute('aria-label', 'Toggle navigation menu');
    
    // Make sure menuToggle is a button for accessibility
    if (menuToggle.tagName !== 'BUTTON') {
      menuToggle.setAttribute('tabindex', '0');
      menuToggle.setAttribute('role', 'button');
    }
  }

  // Keyboard accessibility for menu toggle
  if (menuToggle) {
    menuToggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleMobileMenu();
      }
    });
  }

  // Close mobile menu when clicking on a link
  document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', () => {
      const navLinks = document.querySelector('.nav-links');
      const menuToggle = document.querySelector('.mobile-menu-toggle');
      if (navLinks.classList.contains('active')) {
        navLinks.classList.remove('active');
        menuToggle.textContent = '☰';
        menuToggle.setAttribute('aria-expanded', 'false');
      }
    });
  });

  // Close mobile menu when clicking outside
  document.addEventListener('click', (e) => {
    const navLinks = document.querySelector('.nav-links');
    const menuToggle = document.querySelector('.mobile-menu-toggle');
    
    if (navLinks.classList.contains('active') && 
        !navLinks.contains(e.target) && 
        !menuToggle.contains(e.target)) {
      navLinks.classList.remove('active');
      menuToggle.textContent = '☰';
      menuToggle.setAttribute('aria-expanded', 'false');
    }
  });

  // Smooth scrolling for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });

  // Add focus management for better accessibility
  const focusableElements = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      const focusableContent = document.querySelectorAll(focusableElements);
      const firstFocusableElement = focusableContent[0];
      const lastFocusableElement = focusableContent[focusableContent.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstFocusableElement) {
          lastFocusableElement.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastFocusableElement) {
          firstFocusableElement.focus();
          e.preventDefault();
        }
      }
    }
  });

  // Add skip link functionality
  const skipLink = document.querySelector('.skip-link');
  if (skipLink) {
    skipLink.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(skipLink.getAttribute('href'));
      if (target) {
        target.focus();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }
});

// Add click event listener for mobile menu toggle
document.addEventListener('DOMContentLoaded', () => {
  const menuToggle = document.querySelector('.mobile-menu-toggle');
  if (menuToggle) {
    menuToggle.addEventListener('click', toggleMobileMenu);
  }
});

// Performance optimization: Debounce scroll events
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Add scroll-based animations
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('animate-in');
    }
  });
}, observerOptions);

document.addEventListener('DOMContentLoaded', () => {
  // Observe elements for animation
  document.querySelectorAll('.feature-card, .section').forEach(el => {
    observer.observe(el);
  });
});

// Add loading states for buttons
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.btn').forEach(button => {
    button.addEventListener('click', function() {
      if (!this.classList.contains('btn-loading')) {
        this.classList.add('btn-loading');
        this.setAttribute('aria-busy', 'true');
        
        // Remove loading state after a delay (for demo purposes)
        setTimeout(() => {
          this.classList.remove('btn-loading');
          this.setAttribute('aria-busy', 'false');
        }, 2000);
      }
    });
  });
}); 